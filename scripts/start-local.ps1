param(
  [ValidateSet("cpu", "cuda")]
  [string]$Backend = "cpu"
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $ProjectDir "scripts\runtime.ps1")
Import-ProjectEnvironment -ProjectDir $ProjectDir
$FrontendPort = if ($env:MTC_FRONTEND_PORT) { $env:MTC_FRONTEND_PORT } else { "5173" }

if (-not $env:MTC_SHARED_TOKEN) {
  $TokenBytes = New-Object byte[] 32
  $TokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $TokenGenerator.GetBytes($TokenBytes) } finally { $TokenGenerator.Dispose() }
  $env:MTC_SHARED_TOKEN = ($TokenBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

Set-Location $ProjectDir
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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop or Docker Engine first."
}

if ($Backend -eq "cuda") {
  Write-Host "Docker backend: NVIDIA CUDA (NVIDIA Container Toolkit required)"
  docker compose -f compose.yaml -f compose.cuda.yaml up --build
} else {
  Write-Host "Docker backend: CPU"
  docker compose up --build
}
