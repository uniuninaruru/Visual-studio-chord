$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop or Docker Engine first."
}

Set-Location $ProjectDir
$LanIp = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Sort-Object InterfaceIndex |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($LanIp) {
  Write-Host "Phone URL (same trusted network): http://${LanIp}:5173"
} else {
  Write-Host "Phone URL: http://<desktop-private-ip>:5173"
}

docker compose up --build
