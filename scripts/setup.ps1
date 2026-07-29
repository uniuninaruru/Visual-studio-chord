param(
  [ValidateSet("auto", "cuda", "directml", "cpu", "none")]
  [string]$Acceleration = "auto"
)

$ErrorActionPreference = "Stop"
$AccelerationWasExplicit = $PSBoundParameters.ContainsKey("Acceleration")

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvDir = Join-Path $ProjectDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

. (Join-Path $ProjectDir "scripts\runtime.ps1")
Import-ProjectEnvironment -ProjectDir $ProjectDir
if (-not $AccelerationWasExplicit -and $env:MTC_ACCELERATION) {
  $Acceleration = $env:MTC_ACCELERATION.ToLowerInvariant()
  if ($Acceleration -notin @("auto", "cuda", "directml", "cpu", "none")) {
    throw "MTC_ACCELERATION must be auto, cuda, directml, cpu, or none."
  }
}
Assert-NodeRuntime
$PackageManager = Get-PackageManager -ProjectDir $ProjectDir

Push-Location $ProjectDir
try {
  if ($PackageManager -eq "pnpm") {
    Invoke-Checked -Program "pnpm" -Arguments @("install", "--frozen-lockfile")
  } else {
    Invoke-Checked -Program "npm" -Arguments @("ci", "--no-audit", "--no-fund")
  }
} finally {
  Pop-Location
}

$PythonProgram = $null
$PythonArguments = @()
if ($env:MTC_PYTHON) {
  if (-not (Get-Command $env:MTC_PYTHON -ErrorAction SilentlyContinue)) {
    throw "MTC_PYTHON points to a Python executable that was not found."
  }
  $PythonProgram = $env:MTC_PYTHON
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $PinnedPython = (Get-Content (Join-Path $ProjectDir ".python-version") -Raw).Trim()
  $PinnedParts = $PinnedPython.Split(".")
  $PinnedSelector = "$($PinnedParts[0]).$($PinnedParts[1])"
  $Selectors = @($PinnedSelector, "3.13", "3.11", "3.14") | Select-Object -Unique
  foreach ($Selector in $Selectors) {
    & py "-${Selector}" -c "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) {
      $PythonProgram = "py"
      $PythonArguments = @("-${Selector}")
      break
    }
  }
  if (-not $PythonProgram -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $PythonProgram = "python"
  }
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonProgram = "python"
} else {
  throw "Python was not found. Install the version in .python-version or set MTC_PYTHON."
}

if (-not $PythonProgram) {
  throw "No supported Python 3.11-3.14 interpreter was found. Python 3.12.10 is recommended."
}

& $PythonProgram @PythonArguments -c "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)"
if ($LASTEXITCODE -ne 0) {
  throw "The selected Python is unsupported. Use Python 3.11-3.14 (3.12.10 recommended)."
}

if (-not (Test-Path $VenvPython)) {
  # `venv` on a directory that already exists refuses to touch it and exits
  # non-zero, so an environment whose interpreter has gone — usually a Python
  # that was upgraded or uninstalled out from under it — is never repaired by
  # running this script again. Rebuilding in place is what the user wants and
  # what they cannot get otherwise; -Clear discards only the environment.
  if (Test-Path $VenvDir) {
    Write-Warning "The .venv interpreter is missing, so the environment is being rebuilt."
    Invoke-Checked -Program $PythonProgram -Arguments ($PythonArguments + @("-m", "venv", "--clear", $VenvDir))
  }
  else {
    Invoke-Checked -Program $PythonProgram -Arguments ($PythonArguments + @("-m", "venv", $VenvDir))
  }
}

# Report what is actually wrong. A broken environment and one built on the
# wrong Python need different answers, and telling someone to install a
# supported Python when they already have one sends them somewhere useless.
if (-not (Test-Path $VenvPython)) {
  throw "The .venv interpreter is still missing after a rebuild attempt. Delete the .venv directory and run this script again."
}

& $VenvPython -c "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)"
if ($LASTEXITCODE -ne 0) {
  throw "The existing .venv uses an unsupported Python. Use Python 3.11-3.14 (3.12.10 recommended). It was not removed or overwritten."
}

Invoke-Checked -Program $VenvPython -Arguments @(
  "-m", "pip", "install", "--disable-pip-version-check",
  "pip==25.0.1", "setuptools==83.0.0"
)
Invoke-Checked -Program $VenvPython -Arguments @(
  "-m", "pip", "install", "--disable-pip-version-check",
  "--requirement", (Join-Path $ProjectDir "backend\requirements.lock")
)
Invoke-Checked -Program $VenvPython -Arguments @(
  "-m", "pip", "install", "--disable-pip-version-check",
  "--no-deps", "--no-build-isolation", "--editable", (Join-Path $ProjectDir "backend")
)

$EnvFile = Join-Path $ProjectDir ".env"
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $ProjectDir ".env.example") $EnvFile
  Write-Host "Created .env from .env.example. Existing environment files are never overwritten."
}

if ($Acceleration -eq "none") {
  Write-Host 'PyTorch installation skipped by explicit setup profile "none".'
} else {
  & (Join-Path $ProjectDir "scripts\setup-acceleration.ps1") -Backend $Acceleration
  if ($LASTEXITCODE -ne 0) {
    throw "PyTorch/acceleration setup failed. Browser/theory mode remains available."
  }
}

Invoke-Checked -Program $VenvPython -Arguments @(
  (Join-Path $ProjectDir "scripts\check-environment.py"), "--require-installed"
)

Write-Host "Setup complete. Run .\scripts\dev.ps1"
