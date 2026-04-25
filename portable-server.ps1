$ErrorActionPreference = "Stop"

$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:Dist = Join-Path $script:Root "dist"
$script:HostName = "127.0.0.1"
$script:Port = 4173
$script:Prefix = "http://$($script:HostName):$($script:Port)/"

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".css" { return "text/css; charset=utf-8" }
    ".html" { return "text/html; charset=utf-8" }
    ".ico" { return "image/x-icon" }
    ".js" { return "text/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".map" { return "application/json; charset=utf-8" }
    ".png" { return "image/png" }
    ".svg" { return "image/svg+xml" }
    ".txt" { return "text/plain; charset=utf-8" }
    default { return "application/octet-stream" }
  }
}

if (-not (Test-Path $script:Dist)) {
  Write-Error "dist folder not found: $script:Dist"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($script:Prefix)
$listener.Start()

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)

    if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq "/") {
      $requestPath = "/index.html"
    }

    $relativePath = $requestPath.TrimStart("/").Replace("/", "\")
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $script:Dist $relativePath))

    if (-not $fullPath.StartsWith($script:Dist, [System.StringComparison]::OrdinalIgnoreCase)) {
      $context.Response.StatusCode = 403
      $context.Response.Close()
      continue
    }

    if (-not (Test-Path $fullPath -PathType Leaf)) {
      $fullPath = Join-Path $script:Dist "index.html"
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $context.Response.ContentType = Get-ContentType $fullPath
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.Headers["Cache-Control"] = "no-store"
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
  }
}
finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
