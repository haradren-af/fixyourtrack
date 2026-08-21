param(
  [Parameter(Mandatory = $false)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Get-Sha256Hex.ps1")

$root = Split-Path -Parent $PSScriptRoot
if (-not $ReleaseDirectory) {
  $ReleaseDirectory = Join-Path $root "release"
}
$assetNames = @(
  "FixYourTrack-Tester-Windows.zip"
  "FixYourTrack-Tester-macOS.zip"
  "THIRD_PARTY_NOTICES.txt"
  "SBOM.cdx.json"
)

$version = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$releaseNotesPath = Join-Path $root "RELEASE_NOTES.md"
$releaseNotesHeading = Get-Content -LiteralPath $releaseNotesPath -TotalCount 1
if ($releaseNotesHeading -ne "# FixYourTrack $version") {
  throw "RELEASE_NOTES.md must have a '# FixYourTrack $version' heading."
}

New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "THIRD_PARTY_NOTICES.txt") -Destination $ReleaseDirectory -Force
Copy-Item -LiteralPath (Join-Path $root "SBOM.cdx.json") -Destination $ReleaseDirectory -Force
Copy-Item -LiteralPath $releaseNotesPath -Destination $ReleaseDirectory -Force

$checksumLines = foreach ($assetName in $assetNames) {
  $assetPath = Join-Path $ReleaseDirectory $assetName
  if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
    throw "Cannot assemble release because $assetName is missing."
  }
  $hash = Get-Sha256Hex -LiteralPath $assetPath
  "$hash  $assetName"
}
$checksumLines | Set-Content -LiteralPath (Join-Path $ReleaseDirectory "SHA256SUMS.txt") -Encoding ASCII

& (Join-Path $PSScriptRoot "Test-Release-Assets.ps1") -ReleaseDirectory $ReleaseDirectory
