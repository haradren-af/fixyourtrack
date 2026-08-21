function Get-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  $stream = [System.IO.File]::OpenRead($LiteralPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}
