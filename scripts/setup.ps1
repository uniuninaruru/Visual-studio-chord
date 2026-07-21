$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvDir = Join-Path $ProjectDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  Push-Location $ProjectDir
  try { pnpm install --frozen-lockfile } finally { Pop-Location }
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location $ProjectDir
  try { npm install } finally { Pop-Location }
} else {
  throw "Node.js 22.13+ with pnpm or npm is required for native development. Docker users can run scripts/start-local.ps1 instead."
}

$Python = Get-Command py -ErrorAction SilentlyContinue
if ($Python) {
  & py -3 -m venv $VenvDir
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  & python -m venv $VenvDir
} else {
  throw "Python 3.10+ was not found."
}

& $VenvPython -m pip install --upgrade pip setuptools
& $VenvPython -m pip install -e "$ProjectDir\backend[test]"

Write-Host "Setup complete. Run .\scripts\dev.ps1"
