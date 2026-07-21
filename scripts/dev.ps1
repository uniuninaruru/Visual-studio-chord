$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
  throw "Backend environment not found. Run .\scripts\setup.ps1 first."
}

$BackendArgs = @(
  "-m", "uvicorn", "app.main:app",
  "--app-dir", (Join-Path $ProjectDir "backend"),
  "--host", "127.0.0.1", "--port", "8765", "--reload"
)
$Backend = Start-Process -FilePath $VenvPython -ArgumentList $BackendArgs -PassThru -NoNewWindow

try {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm --dir (Join-Path $ProjectDir "frontend") dev
  } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    & npm --prefix (Join-Path $ProjectDir "frontend") run dev
  } else {
    throw "Node.js package manager not found. Run .\scripts\setup.ps1 first."
  }
} finally {
  if (-not $Backend.HasExited) {
    Stop-Process -Id $Backend.Id
  }
}
