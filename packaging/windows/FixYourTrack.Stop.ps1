$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $runtimeRoot "server.pid"
$urlPath = Join-Path $runtimeRoot "server.url"
$serverScript = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "FixYourTrack.Server.ps1"))

if (Test-Path $pidPath) {
  $serverPid = 0
  $pidIsValid = [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serverPid)
  $serverProcess = if ($pidIsValid) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
  }
  else {
    $null
  }
  $isOwnedServer = $serverProcess -and
    $serverProcess.CommandLine -and
    $serverProcess.CommandLine.IndexOf($serverScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0

  if ($isOwnedServer) {
    Stop-Process -Id $serverPid -Force
    Write-Host "FixYourTrack stopped."
  }
  else {
    Write-Host "FixYourTrack is not running."
  }
}
else {
  Write-Host "FixYourTrack is not running."
}

Remove-Item -LiteralPath $pidPath, $urlPath -Force -ErrorAction SilentlyContinue
