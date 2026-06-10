$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $runtimeRoot
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $packageRoot "app"))
$pidPath = Join-Path $runtimeRoot "server.pid"
$urlPath = Join-Path $runtimeRoot "server.url"
$logPath = Join-Path $runtimeRoot "server.log"
$listener = $null

function Write-ServerLog {
  param([string]$Message)

  "$([DateTime]::Now.ToString('s')) $Message" | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".css" { return "text/css; charset=utf-8" }
    ".html" { return "text/html; charset=utf-8" }
    ".ico" { return "image/x-icon" }
    ".js" { return "text/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".png" { return "image/png" }
    ".svg" { return "image/svg+xml" }
    ".webp" { return "image/webp" }
    default { return "application/octet-stream" }
  }
}

try {
  if (-not (Test-Path (Join-Path $appRoot "index.html"))) {
    throw "app\index.html was not found."
  }

  for ($port = 4173; $port -le 4183; $port += 1) {
    $candidate = New-Object System.Net.HttpListener
    $candidate.Prefixes.Add("http://127.0.0.1:$port/")
    try {
      $candidate.Start()
      $listener = $candidate
      $url = "http://127.0.0.1:$port/"
      break
    }
    catch {
      $candidate.Close()
    }
  }

  if (-not $listener) {
    throw "No free local port was found between 4173 and 4183."
  }

  Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII
  Set-Content -LiteralPath $urlPath -Value $url -Encoding ASCII
  Write-ServerLog "Server started at $url"

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)

    if ($requestPath -eq "/__health") {
      $healthBytes = [System.Text.Encoding]::UTF8.GetBytes("FixYourTrack")
      $context.Response.ContentType = "text/plain; charset=utf-8"
      $context.Response.ContentLength64 = $healthBytes.Length
      $context.Response.OutputStream.Write($healthBytes, 0, $healthBytes.Length)
      $context.Response.OutputStream.Close()
      continue
    }

    if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq "/") {
      $requestPath = "/index.html"
    }

    $relativePath = $requestPath.TrimStart("/").Replace("/", "\")
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $appRoot $relativePath))

    if (-not $fullPath.StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      $context.Response.StatusCode = 403
      $context.Response.Close()
      continue
    }

    if (-not (Test-Path $fullPath -PathType Leaf)) {
      $fullPath = Join-Path $appRoot "index.html"
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $context.Response.ContentType = Get-ContentType $fullPath
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.Headers["Cache-Control"] = "no-store"
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
  }
}
catch {
  Write-ServerLog $_.Exception.Message
  exit 1
}
finally {
  if ($listener -and $listener.IsListening) {
    $listener.Stop()
  }
  if ($listener) {
    $listener.Close()
  }
  Remove-Item -LiteralPath $pidPath, $urlPath -Force -ErrorAction SilentlyContinue
}
