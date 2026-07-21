$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
$url = "http://127.0.0.1:$port"
$stdoutLog = Join-Path $projectRoot '.vite-dev.stdout.log'
$stderrLog = Join-Path $projectRoot '.vite-dev.stderr.log'
$pidFile = Join-Path $projectRoot '.vite-dev.pid'
$startupSmokeTest = Join-Path $projectRoot 'scripts\Dev-Startup-Smoke-Test.mjs'
$startedProcess = $null

function Test-FixYourTrackServer {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and
      $response.Content -match '<title>FixYourTrack</title>' -and
      $response.Content -match '<div id="root"></div>' -and
      $response.Content -match '/@vite/client' -and
      $response.Content -match '/src/main\.jsx'
  } catch {
    return $false
  }
}

function Stop-StartedProcessTree {
  param([int]$RootProcessId)

  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $processIds = [System.Collections.Generic.HashSet[int]]::new()
  [void]$processIds.Add($RootProcessId)
  do {
    $previousCount = $processIds.Count
    foreach ($candidate in $processes) {
      if ($processIds.Contains([int]$candidate.ParentProcessId)) {
        [void]$processIds.Add([int]$candidate.ProcessId)
      }
    }
  } while ($processIds.Count -gt $previousCount)

  foreach ($processId in @($processIds) | Where-Object { $_ -ne $RootProcessId }) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

if (-not (Test-FixYourTrackServer)) {
  $npmCommand = Get-Command 'npm.cmd' -ErrorAction Stop
  $startedProcess = Start-Process `
    -FilePath $npmCommand.Source `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$port", '--strictPort') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Set-Content -LiteralPath $pidFile -Value $startedProcess.Id

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if ($startedProcess.HasExited) {
      break
    }
    if (Test-FixYourTrackServer) {
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-FixYourTrackServer)) {
    $details = if (Test-Path -LiteralPath $stderrLog) {
      (Get-Content -LiteralPath $stderrLog -Tail 20) -join [Environment]::NewLine
    } else {
      'No server error log was produced.'
    }
    if (-not $startedProcess.HasExited) {
      Stop-StartedProcessTree -RootProcessId $startedProcess.Id
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "FixYourTrack did not start correctly.$([Environment]::NewLine)$details"
  }
}

$nodeCommand = Get-Command 'node.exe' -ErrorAction Stop
& $nodeCommand.Source $startupSmokeTest --url $url
if ($LASTEXITCODE -ne 0) {
  if ($startedProcess) {
    Stop-StartedProcessTree -RootProcessId $startedProcess.Id
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
  throw "FixYourTrack responded over HTTP but did not render correctly. See the browser smoke-test error above."
}

Start-Process $url
