$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $root "release"
$packageRoot = Join-Path $releaseRoot "FixYourTrack-portable"
$zipPath = Join-Path $releaseRoot "FixYourTrack-portable.zip"

Push-Location $root
try {
  npm run build

  if (-not (Test-Path $packageRoot)) {
    New-Item -ItemType Directory -Path $packageRoot | Out-Null
  } else {
    Get-ChildItem $packageRoot -Force | Remove-Item -Recurse -Force
  }

  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }
  Copy-Item (Join-Path $root "dist") -Destination $packageRoot -Recurse
  Copy-Item (Join-Path $root "start-fixyourtrack.bat") -Destination $packageRoot
  Copy-Item (Join-Path $root "stop-fixyourtrack.bat") -Destination $packageRoot
  Copy-Item (Join-Path $root "portable-server.ps1") -Destination $packageRoot
  Copy-Item (Join-Path $root "README.md") -Destination (Join-Path $packageRoot "README.txt")

  Compress-Archive -Path $packageRoot -DestinationPath $zipPath -Force
  Write-Host "Portable package created:"
  Write-Host $zipPath
}
finally {
  Pop-Location
}
