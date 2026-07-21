param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $runtimeRoot
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $packageRoot "app"))
$appRootPrefix = $appRoot.TrimEnd("\") + "\"
$pidPath = Join-Path $runtimeRoot "server.pid"
$urlPath = Join-Path $runtimeRoot "server.url"
$logPath = Join-Path $runtimeRoot "server.log"
$versionPath = Join-Path $packageRoot "VERSION.txt"
$listener = $null
$port = $Port
$contentSecurityPolicy = "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com; connect-src 'self' https://tile.openstreetmap.org https://server.arcgisonline.com https://router.project-osrm.org https://brouter.de https://routing.openstreetmap.de https://api.open-elevation.com; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

function Get-PackageHealthToken {
  if (-not (Test-Path -LiteralPath $versionPath -PathType Leaf)) {
    throw "VERSION.txt was not found."
  }
  $content = Get-Content -LiteralPath $versionPath
  $version = ($content | Where-Object { $_ -match '^Version: ' } | Select-Object -First 1) -replace '^Version: ', ''
  $revision = ($content | Where-Object { $_ -match '^Revision: ' } | Select-Object -First 1) -replace '^Revision: ', ''
  if (-not $version -or -not $revision) {
    throw "VERSION.txt does not contain a version and revision."
  }
  return "FixYourTrack/$version/$revision"
}

function Write-ServerLog {
  param([string]$Message)

  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1MB) {
    Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8
  }
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

function Set-SecurityHeaders {
  param([System.Net.HttpListenerResponse]$Response)

  $Response.Headers["Content-Security-Policy"] = $contentSecurityPolicy
  $Response.Headers["Cross-Origin-Opener-Policy"] = "same-origin"
  $Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin"
  $Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
  $Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
  $Response.Headers["X-Content-Type-Options"] = "nosniff"
  $Response.Headers["X-Frame-Options"] = "DENY"
}

try {
  if (-not (Test-Path (Join-Path $appRoot "index.html"))) {
    throw "app\index.html was not found."
  }
  $healthResponse = Get-PackageHealthToken

  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  try {
    $listener.Start()
  }
  catch {
    $listener.Close()
    $listener = $null
    throw "Local port $port is unavailable. Close the program using it, then start FixYourTrack again."
  }
  $url = "http://127.0.0.1:$port/"

  Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII
  Set-Content -LiteralPath $urlPath -Value $url -Encoding ASCII
  Write-ServerLog "Server started at $url"

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      Set-SecurityHeaders $context.Response
      $context.Response.Headers["Cache-Control"] = "no-store"

      if ($context.Request.UserHostName -ne "127.0.0.1:$port") {
        $context.Response.StatusCode = 421
        $context.Response.Close()
        continue
      }

      if ($context.Request.HttpMethod -notin @("GET", "HEAD")) {
        $context.Response.StatusCode = 405
        $context.Response.Headers["Allow"] = "GET, HEAD"
        $context.Response.Close()
        continue
      }

      $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
      if ($requestPath -eq "/__health") {
        $healthBytes = [System.Text.Encoding]::UTF8.GetBytes($healthResponse)
        $context.Response.ContentType = "text/plain; charset=utf-8"
        $context.Response.ContentLength64 = $healthBytes.Length
        if ($context.Request.HttpMethod -ne "HEAD") {
          $context.Response.OutputStream.Write($healthBytes, 0, $healthBytes.Length)
        }
        $context.Response.Close()
        continue
      }

      if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq "/") {
        $requestPath = "/index.html"
      }

      $relativePath = $requestPath.TrimStart("/").Replace("/", "\")
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $appRoot $relativePath))
      $isInsideApp = $fullPath.Equals($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($appRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
      if (-not $isInsideApp) {
        $context.Response.StatusCode = 403
        $context.Response.Close()
        continue
      }

      if (-not (Test-Path $fullPath -PathType Leaf)) {
        if ([System.IO.Path]::HasExtension($requestPath)) {
          $context.Response.StatusCode = 404
          $context.Response.Close()
          continue
        }
        $fullPath = Join-Path $appRoot "index.html"
      }

      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      $context.Response.ContentType = Get-ContentType $fullPath
      $context.Response.ContentLength64 = $bytes.Length
      if ($context.Request.HttpMethod -ne "HEAD") {
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      $context.Response.Close()
    }
    catch {
      Write-ServerLog "Request failed: $($_.Exception.Message)"
      try {
        $context.Response.StatusCode = 400
        $context.Response.Close()
      }
      catch {}
    }
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
