$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$releaseRoot = Join-Path $root "release"
$packageRoot = Join-Path $releaseRoot "FixYourTrack-macOS"
$zipPath = Join-Path $releaseRoot "FixYourTrack-Tester-macOS.zip"
$appRoot = Join-Path $packageRoot "app"
$runtimeRoot = Join-Path $packageRoot "runtime"
$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$goVersion = "go1.26.4"
$goArchiveName = "$goVersion.windows-amd64.zip"
$goArchiveSha256 = "3ca8fb4630b07c419cbdd51f754e31363cfcfb83b3a5354d9e895c90be2cc345"
$toolRoot = Join-Path ([System.IO.Path]::GetTempPath()) "FixYourTrack-Packaging\$goVersion"
$goArchivePath = Join-Path ([System.IO.Path]::GetTempPath()) "FixYourTrack-Packaging\$goArchiveName"
$portableGoExe = Join-Path $toolRoot "go\bin\go.exe"
$goExe = $null

function Assert-ReleasePath {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullReleaseRoot = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $fullPath.StartsWith($fullReleaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release folder: $fullPath"
  }
}

function Install-PortableGo {
  $portableGoIsComplete =
    (Test-Path $portableGoExe -PathType Leaf) -and
    (Test-Path (Join-Path $toolRoot "go\bin\gofmt.exe") -PathType Leaf) -and
    (Test-Path (Join-Path $toolRoot "go\src\fmt\print.go") -PathType Leaf) -and
    (Test-Path (Join-Path $toolRoot "go\pkg\tool\windows_amd64\compile.exe") -PathType Leaf)
  if ($portableGoIsComplete) {
    return
  }

  $archiveDirectory = Split-Path -Parent $goArchivePath
  New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null

  if (-not (Test-Path $goArchivePath)) {
    Write-Host "Downloading temporary Go toolchain $goVersion..."
    Invoke-WebRequest -Uri "https://go.dev/dl/$goArchiveName" -OutFile $goArchivePath
  }

  $stream = [System.IO.File]::OpenRead($goArchivePath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $actualSha256 = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
  if ($actualSha256 -ne $goArchiveSha256) {
    throw "Portable Go archive checksum mismatch."
  }

  if (Test-Path $toolRoot) {
    Remove-Item -LiteralPath $toolRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
  Expand-Archive -LiteralPath $goArchivePath -DestinationPath $toolRoot
}

function Resolve-GoExecutable {
  if ($env:FIXYOURTRACK_GO_EXE -and (Test-Path $env:FIXYOURTRACK_GO_EXE)) {
    return $env:FIXYOURTRACK_GO_EXE
  }

  $systemGo = Get-Command "go" -ErrorAction SilentlyContinue
  if ($systemGo) {
    return $systemGo.Source
  }

  Install-PortableGo
  return $portableGoExe
}

function Build-Server {
  param(
    [string]$Architecture,
    [string]$OutputPath
  )

  $previousGoOs = $env:GOOS
  $previousGoArch = $env:GOARCH
  $previousCgoEnabled = $env:CGO_ENABLED
  try {
    $env:GOOS = "darwin"
    $env:GOARCH = $Architecture
    $env:CGO_ENABLED = "0"
    & $goExe build -trimpath -ldflags="-s -w" -o $OutputPath (Join-Path $root "packaging\macos\server\main.go")
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to build macOS server for $Architecture."
    }
  }
  finally {
    $env:GOOS = $previousGoOs
    $env:GOARCH = $previousGoArch
    $env:CGO_ENABLED = $previousCgoEnabled
  }
}

Push-Location $root
try {
  npm run supply-chain:check
  if ($LASTEXITCODE -ne 0) {
    throw "Supply-chain artifacts are stale or invalid."
  }

  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Application build failed."
  }

  $goExe = Resolve-GoExecutable
  Assert-ReleasePath $packageRoot
  Assert-ReleasePath $zipPath

  if (Test-Path $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
  }
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

  Copy-Item -Path (Join-Path $root "dist\*") -Destination $appRoot -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\macos\Start FixYourTrack.command") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\macos\Stop FixYourTrack.command") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\macos\README.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\TESTING-CHECKLIST.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "THIRD_PARTY_NOTICES.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "SBOM.cdx.json") -Destination $packageRoot

  Build-Server -Architecture "arm64" -OutputPath (Join-Path $runtimeRoot "fixyourtrack-server-arm64")
  Build-Server -Architecture "amd64" -OutputPath (Join-Path $runtimeRoot "fixyourtrack-server-x64")

  $commit = git rev-parse --short HEAD 2>$null
  if (-not $commit) {
    $commit = "uncommitted"
  }
  $workingTreeStatus = git status --porcelain 2>$null
  if ($workingTreeStatus) {
    $commit = "$commit-dirty"
  }
  @(
    "FixYourTrack macOS package"
    "Version: $version"
    "Built: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))"
    "Revision: $commit"
    "Architectures: Apple Silicon (arm64), Intel (x86_64)"
  ) | Set-Content -LiteralPath (Join-Path $packageRoot "VERSION.txt") -Encoding UTF8

  & $goExe run (Join-Path $root "packaging\macos\zip\main.go") -source $packageRoot -output $zipPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create macOS tester ZIP."
  }

  Write-Host ""
  Write-Host "Tester package created:"
  Write-Host $zipPath
}
finally {
  Pop-Location
}
