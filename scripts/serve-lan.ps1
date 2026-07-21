$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $ProjectDir "scripts\runtime.ps1")
Import-ProjectEnvironment -ProjectDir $ProjectDir
$env:MTC_FRONTEND_HOST = "0.0.0.0"
$FrontendPort = if ($env:MTC_FRONTEND_PORT) { $env:MTC_FRONTEND_PORT } else { "5173" }

if (-not $env:MTC_SHARED_TOKEN) {
  $TokenBytes = New-Object byte[] 32
  $TokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $TokenGenerator.GetBytes($TokenBytes) } finally { $TokenGenerator.Dispose() }
  $env:MTC_SHARED_TOKEN = ($TokenBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

$LanIp = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Sort-Object InterfaceIndex |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($LanIp) {
  Write-Host "Desktop URL: http://127.0.0.1:${FrontendPort}/#access=$($env:MTC_SHARED_TOKEN)"
  Write-Host "Phone URL (same trusted network): http://${LanIp}:${FrontendPort}/#access=$($env:MTC_SHARED_TOKEN)"
} else {
  Write-Host "Desktop URL: http://127.0.0.1:${FrontendPort}/#access=$($env:MTC_SHARED_TOKEN)"
  Write-Host "Phone URL: http://<desktop-private-ip>:${FrontendPort}/#access=$($env:MTC_SHARED_TOKEN)"
}

if ($env:MTC_LAUNCH_DRY_RUN -eq "1") { return }

& (Join-Path $ProjectDir "scripts\dev.ps1")
