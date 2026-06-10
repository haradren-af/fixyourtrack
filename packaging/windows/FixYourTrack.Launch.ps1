$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $runtimeRoot
$appIndex = Join-Path $packageRoot "app\index.html"
$serverScript = Join-Path $runtimeRoot "FixYourTrack.Server.ps1"
$urlPath = Join-Path $runtimeRoot "server.url"
$pidPath = Join-Path $runtimeRoot "server.pid"
$logPath = Join-Path $runtimeRoot "server.log"

function Get-RunningUrl {
  if (-not (Test-Path $urlPath)) {
    return $null
  }

  $url = (Get-Content -LiteralPath $urlPath -Raw).Trim()
  try {
    $response = Invoke-WebRequest -UseBasicParsing ($url + "__health") -TimeoutSec 2
    if ($response.Content -eq "FixYourTrack") {
      return $url
    }
  }
  catch {
    return $null
  }

  return $null
}

if (-not (Test-Path $appIndex) -or -not (Test-Path $serverScript)) {
  Write-Error "This FixYourTrack folder is incomplete. Extract the complete ZIP archive."
}

$runningUrl = Get-RunningUrl
if ($runningUrl) {
  Start-Process $runningUrl
  exit 0
}

Remove-Item -LiteralPath $urlPath, $pidPath, $logPath -Force -ErrorAction SilentlyContinue
$quotedServerScript = '"' + $serverScript.Replace('"', '\"') + '"'
Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $quotedServerScript) `
  -WindowStyle Hidden | Out-Null

for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $runningUrl = Get-RunningUrl
  if ($runningUrl) {
    Start-Process $runningUrl
    exit 0
  }
}

Write-Error "The local FixYourTrack server did not become ready."
