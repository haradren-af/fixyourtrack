$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "FixYourTrack-Server-Test-$PID"
$expectedPrefix = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) "FixYourTrack-Server-Test-"))
$resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
if (-not $resolvedTestRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use an unexpected test path: $resolvedTestRoot"
}

$appRoot = Join-Path $testRoot "app"
$runtimeRoot = Join-Path $testRoot "runtime"
$serverPath = Join-Path $runtimeRoot "FixYourTrack.Server.ps1"
$process = $null
$tcpListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$tcpListener.Start()
$port = ([System.Net.IPEndPoint]$tcpListener.LocalEndpoint).Port
$tcpListener.Stop()
$baseUrl = "http://127.0.0.1:$port/"

try {
  New-Item -ItemType Directory -Path $appRoot, $runtimeRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $appRoot "index.html") -Value "app shell" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $appRoot "app.js") -Value "export {};" -Encoding UTF8
  @("Version: 0.0.0-test", "Revision: server-test") |
    Set-Content -LiteralPath (Join-Path $testRoot "VERSION.txt") -Encoding UTF8
  Copy-Item -LiteralPath (Join-Path $root "packaging\windows\FixYourTrack.Server.ps1") -Destination $serverPath

  $process = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $serverPath,
    "-Port", $port
  )

  $healthy = $false
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing ($baseUrl + "__health") -TimeoutSec 1
      if ($health.StatusCode -eq 200 -and $health.Content -eq "FixYourTrack/0.0.0-test/server-test") {
        $healthy = $true
        break
      }
    }
    catch {
      Start-Sleep -Milliseconds 100
    }
  }
  if (-not $healthy) {
    throw "Windows package server did not become healthy."
  }

  $response = Invoke-WebRequest -UseBasicParsing $baseUrl -TimeoutSec 2
  if ($response.StatusCode -ne 200 -or $response.Content -notmatch "app shell") {
    throw "The app shell was not served."
  }
  if ($response.Headers["X-Content-Type-Options"] -ne "nosniff") {
    throw "X-Content-Type-Options is missing."
  }
  if ($response.Headers["Cross-Origin-Opener-Policy"] -ne "same-origin") {
    throw "Cross-Origin-Opener-Policy is missing."
  }
  if ($response.Headers["X-Frame-Options"] -ne "DENY") {
    throw "X-Frame-Options is missing."
  }
  if ($response.Headers["Referrer-Policy"] -ne "strict-origin-when-cross-origin") {
    throw "Referrer-Policy is not compatible with map tile attribution."
  }
  if ($response.Headers["Content-Security-Policy"] -notmatch "frame-ancestors 'none'") {
    throw "The Content-Security-Policy does not prevent framing."
  }

  foreach ($case in @(
    @{ Method = "POST"; Path = ""; Status = 405 },
    @{ Method = "GET"; Path = "missing.js"; Status = 404 },
    @{ Method = "GET"; Path = "%2e%2e/secret.txt"; Status = 403 }
  )) {
    try {
      Invoke-WebRequest -UseBasicParsing ($baseUrl + $case.Path) -Method $case.Method -TimeoutSec 2 | Out-Null
      throw "Expected HTTP $($case.Status) for $($case.Method) /$($case.Path)."
    }
    catch {
      $status = [int]$_.Exception.Response.StatusCode
      if ($status -ne $case.Status) {
        throw "HTTP $status for $($case.Method) /$($case.Path); expected $($case.Status)."
      }
    }
  }

  Write-Host "Windows package server tests passed."
}
finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $null = $process.WaitForExit(5000)
  }
  if (Test-Path -LiteralPath $resolvedTestRoot) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
