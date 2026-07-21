param(
  [Parameter(Mandatory = $false)]
  [string]$ReleaseDirectory,

  [Parameter(Mandatory = $false)]
  [switch]$StrictAssetSet
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot "package.json"
$packageMetadata = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageMetadata.version
$revisionOutput = @(& git -C $projectRoot rev-parse HEAD 2>$null)
$revisionExitCode = $LASTEXITCODE
$expectedRevision = [string]($revisionOutput | Select-Object -First 1)

if ($expectedVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "package.json contains an invalid release version: $expectedVersion"
}
if ($revisionExitCode -ne 0 -or $expectedRevision.Trim() -notmatch '^[a-f0-9]{40,64}$') {
  throw "Release verification requires a valid Git HEAD revision."
}
$expectedRevision = $expectedRevision.Trim()

if (-not $ReleaseDirectory) {
  $ReleaseDirectory = Join-Path $projectRoot "release"
}

$assetNames = @(
  "FixYourTrack-Tester-Windows.zip"
  "FixYourTrack-Tester-macOS.zip"
  "THIRD_PARTY_NOTICES.txt"
  "SBOM.cdx.json"
)
$checksumPath = Join-Path $ReleaseDirectory "SHA256SUMS.txt"

if ($StrictAssetSet) {
  $allowedNames = @($assetNames) + @("SHA256SUMS.txt")
  $actualNames = @(Get-ChildItem -LiteralPath $ReleaseDirectory -File | ForEach-Object Name)
  $unexpectedNames = @($actualNames | Where-Object { $allowedNames -notcontains $_ })
  if ($unexpectedNames.Count -gt 0) {
    throw "Unexpected release assets: $($unexpectedNames -join ', ')"
  }
}

foreach ($assetName in $assetNames) {
  $assetPath = Join-Path $ReleaseDirectory $assetName
  if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
    throw "Missing release asset: $assetName"
  }
  if ((Get-Item -LiteralPath $assetPath).Length -le 0) {
    throw "Release asset is empty: $assetName"
  }
}

if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "Missing release checksum manifest: SHA256SUMS.txt"
}

$expectedChecksums = @{}
foreach ($line in Get-Content -LiteralPath $checksumPath) {
  if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') {
    throw "Invalid SHA256SUMS.txt line: $line"
  }
  $name = $Matches[2]
  if ($assetNames -notcontains $name) {
    throw "Unexpected asset in SHA256SUMS.txt: $name"
  }
  if ($expectedChecksums.ContainsKey($name)) {
    throw "Duplicate asset in SHA256SUMS.txt: $name"
  }
  $expectedChecksums[$name] = $Matches[1]
}

foreach ($assetName in $assetNames) {
  if (-not $expectedChecksums.ContainsKey($assetName)) {
    throw "SHA256SUMS.txt does not cover $assetName"
  }
  $actual = (Get-FileHash -LiteralPath (Join-Path $ReleaseDirectory $assetName) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expectedChecksums[$assetName]) {
    throw "SHA-256 mismatch for $assetName"
  }
}

$notices = Get-Content -LiteralPath (Join-Path $ReleaseDirectory "THIRD_PARTY_NOTICES.txt") -Raw
if ($notices -notmatch 'FixYourTrack Third-Party Notices' -or $notices -notmatch 'Production dependency components: [1-9][0-9]*') {
  throw "THIRD_PARTY_NOTICES.txt does not look like a generated dependency notice."
}

$sbom = Get-Content -LiteralPath (Join-Path $ReleaseDirectory "SBOM.cdx.json") -Raw | ConvertFrom-Json
if ($sbom.bomFormat -ne "CycloneDX" -or $sbom.specVersion -ne "1.5" -or $sbom.components.Count -le 0) {
  throw "SBOM.cdx.json is not the expected non-empty CycloneDX 1.5 document."
}
if ([string]$sbom.metadata.component.name -ne [string]$packageMetadata.name -or
    [string]$sbom.metadata.component.version -ne $expectedVersion) {
  throw "SBOM metadata does not match package.json name/version ($($packageMetadata.name) $expectedVersion)."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$maximumArchiveEntries = 10000
$maximumArchiveUncompressedBytes = 256MB
$maximumEntryUncompressedBytes = 128MB

function Test-PackageArchive {
  param(
    [string]$ArchiveName,
    [string]$RootName,
    [string[]]$RequiredEntries,
    [string[]]$ExecutableEntries = @(),
    [string]$ExpectedVersion,
    [string]$ExpectedRevision
  )

  $archivePath = Join-Path $ReleaseDirectory $ArchiveName
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entries = @{}
    [long]$totalUncompressedBytes = 0
    if ($archive.Entries.Count -gt $maximumArchiveEntries) {
      throw "$ArchiveName contains too many ZIP entries (maximum $maximumArchiveEntries)."
    }
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace("\", "/")
      if ($name.StartsWith("/") -or $name -match '(^|/)\.\.(/|$)' -or -not $name.StartsWith("$RootName/")) {
        throw "Unsafe or unexpected ZIP entry in ${ArchiveName}: $name"
      }
      if ($entries.ContainsKey($name)) {
        throw "Duplicate ZIP entry in ${ArchiveName}: $name"
      }
      if ($entry.Length -gt $maximumEntryUncompressedBytes) {
        throw "ZIP entry in $ArchiveName exceeds the per-file uncompressed size limit: $name"
      }
      $totalUncompressedBytes += $entry.Length
      if ($totalUncompressedBytes -gt $maximumArchiveUncompressedBytes) {
        throw "$ArchiveName exceeds the total uncompressed size limit."
      }
      $entries[$name] = $entry
    }

    foreach ($requiredEntry in $RequiredEntries) {
      if (-not $entries.ContainsKey("$RootName/$requiredEntry")) {
        throw "$ArchiveName does not contain $RootName/$requiredEntry"
      }
    }

    foreach ($executableEntry in $ExecutableEntries) {
      $entryName = "$RootName/$executableEntry"
      if (-not $entries.ContainsKey($entryName)) {
        throw "$ArchiveName does not contain executable $entryName"
      }

      $entry = $entries[$entryName]
      $unsignedAttributes = [uint32](([int64]$entry.ExternalAttributes) -band 0xFFFFFFFFL)
      $unixMode = [int](($unsignedAttributes -shr 16) -band 0xFFFF)
      $unixFileType = $unixMode -band 0xF000
      $allExecuteBits = 0x49
      if ($unixFileType -ne 0x8000) {
        throw "$ArchiveName entry $entryName is not marked as a regular Unix file (mode 0x$($unixMode.ToString('x4')))."
      }
      if (($unixMode -band $allExecuteBits) -ne $allExecuteBits) {
        throw "$ArchiveName entry $entryName is missing owner, group, or other execute permission (mode 0x$($unixMode.ToString('x4')))."
      }
    }

    $buffer = [byte[]]::new(81920)
    foreach ($entryName in $entries.Keys) {
      if ($entryName.EndsWith('/')) {
        continue
      }
      $entry = $entries[$entryName]
      $entryStream = $entry.Open()
      try {
        [long]$bytesRead = 0
        while (($readCount = $entryStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $bytesRead += $readCount
          if ($bytesRead -gt $entry.Length) {
            throw "ZIP entry expanded past its declared length: $entryName"
          }
        }
        if ($bytesRead -ne $entry.Length) {
          throw "ZIP entry did not expand to its declared length: $entryName"
        }
      }
      catch {
        throw "Unreadable or corrupt ZIP entry in ${ArchiveName}: $entryName. $($_.Exception.Message)"
      }
      finally {
        $entryStream.Dispose()
      }
    }

    $versionEntry = $entries["$RootName/VERSION.txt"]
    $versionStream = $versionEntry.Open()
    try {
      $versionReader = [System.IO.StreamReader]::new($versionStream)
      try {
        $versionText = $versionReader.ReadToEnd()
      }
      finally {
        $versionReader.Dispose()
      }
    }
    finally {
      $versionStream.Dispose()
    }

    $versionMatch = [regex]::Match($versionText, '(?m)^Version:\s*(\S+)\s*$')
    $revisionMatch = [regex]::Match($versionText, '(?m)^Revision:\s*(\S+)\s*$')
    if (-not $versionMatch.Success -or -not $revisionMatch.Success) {
      throw "$ArchiveName has an invalid VERSION.txt."
    }

    $archiveVersion = $versionMatch.Groups[1].Value
    $archiveRevision = $revisionMatch.Groups[1].Value
    if ($archiveVersion -ne $ExpectedVersion) {
      throw "$ArchiveName was built for version $archiveVersion; expected $ExpectedVersion."
    }
    if ($archiveRevision -eq "uncommitted" -or $archiveRevision -match '-dirty$') {
      throw "$ArchiveName was built from an uncommitted or dirty worktree ($archiveRevision)."
    }
    if ($archiveRevision -notmatch '^[a-f0-9]{7,64}$') {
      throw "$ArchiveName has an invalid source revision: $archiveRevision"
    }
    if (-not $ExpectedRevision.StartsWith($archiveRevision, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "$ArchiveName was built from revision $archiveRevision; expected current revision $ExpectedRevision."
    }

    return [pscustomobject]@{
      Version = $archiveVersion
      Revision = $archiveRevision
    }
  }
  finally {
    $archive.Dispose()
  }
}

$windowsPackage = Test-PackageArchive `
  -ArchiveName "FixYourTrack-Tester-Windows.zip" `
  -RootName "FixYourTrack" `
  -ExpectedVersion $expectedVersion `
  -ExpectedRevision $expectedRevision `
  -RequiredEntries @(
    "THIRD_PARTY_NOTICES.txt"
    "SBOM.cdx.json"
    "VERSION.txt"
    "Start FixYourTrack.cmd"
    "Stop FixYourTrack.cmd"
    "README.txt"
    "TESTING-CHECKLIST.txt"
    "app/index.html"
    "runtime/FixYourTrack.Launch.ps1"
    "runtime/FixYourTrack.Server.ps1"
    "runtime/FixYourTrack.Stop.ps1"
  )

$macosPackage = Test-PackageArchive `
  -ArchiveName "FixYourTrack-Tester-macOS.zip" `
  -RootName "FixYourTrack-macOS" `
  -ExpectedVersion $expectedVersion `
  -ExpectedRevision $expectedRevision `
  -ExecutableEntries @(
    "Start FixYourTrack.command"
    "Stop FixYourTrack.command"
    "runtime/fixyourtrack-server-arm64"
    "runtime/fixyourtrack-server-x64"
  ) `
  -RequiredEntries @(
    "THIRD_PARTY_NOTICES.txt"
    "SBOM.cdx.json"
    "VERSION.txt"
    "Start FixYourTrack.command"
    "Stop FixYourTrack.command"
    "README.txt"
    "TESTING-CHECKLIST.txt"
    "app/index.html"
    "runtime/fixyourtrack-server-arm64"
    "runtime/fixyourtrack-server-x64"
  )

if ($windowsPackage.Revision -ne $macosPackage.Revision) {
  throw "Windows and macOS packages were built from different revisions."
}

Write-Host "Verified release $expectedVersion checksums, SBOM, notices, package contents, macOS executable modes, and source revision $($windowsPackage.Revision)."
