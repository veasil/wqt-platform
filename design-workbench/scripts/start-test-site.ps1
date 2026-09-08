$ErrorActionPreference = 'Stop'

$workbenchRoot = Split-Path -Parent $PSScriptRoot
$cacheDirectory = Join-Path $workbenchRoot '.cache\test-site'
$cloudflaredPath = Join-Path (Split-Path -Parent $workbenchRoot) '.tools\cloudflared.exe'
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-BackgroundService([string]$Name, [string[]]$Arguments) {
  $stdoutPath = Join-Path $cacheDirectory "$Name.stdout.log"
  $stderrPath = Join-Path $cacheDirectory "$Name.stderr.log"
  $process = Start-Process -FilePath $npmPath `
    -ArgumentList $Arguments `
    -WorkingDirectory $workbenchRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  return $process
}

$apiProcess = $null
$webProcess = $null

if (-not (Test-Port 8080)) {
  $apiProcess = Start-BackgroundService -Name 'api' -Arguments @('run', 'cards:dev')
}
if (-not (Test-Port 4173)) {
  $webProcess = Start-BackgroundService -Name 'web' -Arguments @('run', 'dev', '--', '--port', '4173')
}

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline -and (-not (Test-Port 8080) -or -not (Test-Port 4173))) {
  Start-Sleep -Milliseconds 500
}
if (-not (Test-Port 8080) -or -not (Test-Port 4173)) {
  throw 'Workbench 前端或 API 未能在 25 秒内启动，请查看 .cache/test-site 日志。'
}

if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  throw "找不到 cloudflared：$cloudflaredPath"
}

$tunnelStdout = Join-Path $cacheDirectory 'tunnel.stdout.log'
$tunnelStderr = Join-Path $cacheDirectory 'tunnel.stderr.log'
$tunnelProcess = Start-Process -FilePath $cloudflaredPath `
  -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:4173', '--no-autoupdate') `
  -WorkingDirectory $workbenchRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelStdout `
  -RedirectStandardError $tunnelStderr `
  -PassThru

$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
  Start-Sleep -Milliseconds 500
  $logs = @(
    (Get-Content -LiteralPath $tunnelStdout -Raw -ErrorAction SilentlyContinue),
    (Get-Content -LiteralPath $tunnelStderr -Raw -ErrorAction SilentlyContinue)
  ) -join "`n"
  $match = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) { $tunnelUrl = $match.Value }
}
if (-not $tunnelUrl) {
  throw 'Cloudflare Quick Tunnel 未能在 30 秒内返回地址，请查看 tunnel 日志。'
}

$state = [ordered]@{
  startedAt = (Get-Date).ToString('o')
  url = $tunnelUrl
  apiPid = if ($apiProcess) { $apiProcess.Id } else { $null }
  webPid = if ($webProcess) { $webProcess.Id } else { $null }
  tunnelPid = $tunnelProcess.Id
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cacheDirectory 'state.json') -Encoding utf8
$state
