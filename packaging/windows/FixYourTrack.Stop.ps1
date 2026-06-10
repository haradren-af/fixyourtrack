$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $runtimeRoot "server.pid"
$urlPath = Join-Path $runtimeRoot "server.url"

if (Test-Path $pidPath) {
  $serverPid = [int](Get-Content -LiteralPath $pidPath -Raw)
  $serverProcess = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
  if ($serverProcess) {
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
