$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"

. (Join-Path $ProjectDir "scripts\runtime.ps1")
Import-ProjectEnvironment -ProjectDir $ProjectDir
Assert-NodeRuntime
$PackageManager = Get-PackageManager -ProjectDir $ProjectDir

if (-not (Test-Path $VenvPython)) {
  throw "Backend test environment not found. Run .\scripts\setup.ps1 first."
}

Invoke-FrontendScript -PackageManager $PackageManager -ProjectDir $ProjectDir -ScriptName "typecheck"
Invoke-FrontendScript -PackageManager $PackageManager -ProjectDir $ProjectDir -ScriptName "lint"
Invoke-FrontendScript -PackageManager $PackageManager -ProjectDir $ProjectDir -ScriptName "test"
Invoke-FrontendScript -PackageManager $PackageManager -ProjectDir $ProjectDir -ScriptName "build"

Push-Location (Join-Path $ProjectDir "backend")
try {
  Invoke-Checked -Program $VenvPython -Arguments @("-m", "pytest")
  Invoke-Checked -Program $VenvPython -Arguments @("-m", "ruff", "check", "app", "tests")
} finally {
  Pop-Location
}

Invoke-Checked -Program $VenvPython -Arguments @(
  "-m", "unittest", "discover",
  "--start-directory", (Join-Path $ProjectDir "scripts\tests"),
  "--pattern", "test_*.py"
)
Invoke-Checked -Program $VenvPython -Arguments @(
  (Join-Path $ProjectDir "scripts\check-private-artifacts.py")
)
Invoke-Checked -Program $VenvPython -Arguments @(
  (Join-Path $ProjectDir "scripts\check-environment.py"), "--require-installed"
)
