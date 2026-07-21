$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$releaseRoot = Join-Path $root "release"
$packageRoot = Join-Path $releaseRoot "FixYourTrack"
$zipPath = Join-Path $releaseRoot "FixYourTrack-Tester-Windows.zip"
$appRoot = Join-Path $packageRoot "app"
$runtimeRoot = Join-Path $packageRoot "runtime"
$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

function Assert-ReleasePath {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullReleaseRoot = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $fullPath.StartsWith($fullReleaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release folder: $fullPath"
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
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\Start FixYourTrack.cmd") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\Stop FixYourTrack.cmd") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\README.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\TESTING-CHECKLIST.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "THIRD_PARTY_NOTICES.txt") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "SBOM.cdx.json") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\FixYourTrack.Server.ps1") -Destination $runtimeRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\FixYourTrack.Launch.ps1") -Destination $runtimeRoot
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\FixYourTrack.Stop.ps1") -Destination $runtimeRoot

  $commit = git rev-parse --short HEAD 2>$null
  if (-not $commit) {
    $commit = "uncommitted"
  }
  $workingTreeStatus = git status --porcelain 2>$null
  if ($workingTreeStatus) {
    $commit = "$commit-dirty"
  }
  @(
    "FixYourTrack Windows package"
    "Version: $version"
    "Built: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))"
    "Revision: $commit"
  ) | Set-Content -LiteralPath (Join-Path $packageRoot "VERSION.txt") -Encoding UTF8

  Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal

  Write-Host ""
  Write-Host "Tester package created:"
  Write-Host $zipPath
}
finally {
  Pop-Location
}
