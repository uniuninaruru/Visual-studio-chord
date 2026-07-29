param(
  [ValidateSet("auto", "cuda", "directml", "cpu")]
  [string]$Backend = "auto"
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"
$ProbeScript = Join-Path $ProjectDir "scripts\verify_acceleration.py"

if (-not (Test-Path $VenvPython)) {
  throw "Backend environment not found. Run .\scripts\setup.ps1 first."
}

$AutoRequested = $Backend -eq "auto"
if ($Backend -eq "auto") {
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $Backend = "cuda"
  } else {
    # HarmonyForge uses PyTorch. DirectML remains an explicit ONNX-ranker mode.
    $Backend = "cpu"
  }
}

# ONNX Runtime variants share the same Python module and must not coexist.
& $VenvPython -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml | Out-Host

function Install-Lock {
  param([Parameter(Mandatory = $true)][string]$Name)

  & $VenvPython -m pip install --upgrade --requirement `
    (Join-Path $ProjectDir "backend\$Name") | Out-Host
  return $LASTEXITCODE
}

switch ($Backend) {
  "cuda" {
    $InstallExitCode = Install-Lock "requirements-acceleration-cuda.lock"
  }
  "directml" {
    $InstallExitCode = Install-Lock "requirements-acceleration-directml.lock"
  }
  "cpu" {
    $InstallExitCode = Install-Lock "requirements-acceleration-cpu.lock"
  }
}

if ($InstallExitCode -ne 0 -and -not $AutoRequested) {
  throw "Inference runtime installation failed. The basic app remains available without it."
}

if ($InstallExitCode -eq 0 -and $Backend -eq "cpu") {
  & $VenvPython $ProbeScript --require-torch-device cpu
  $ProbeExitCode = $LASTEXITCODE
} elseif ($InstallExitCode -eq 0 -and $Backend -eq "cuda") {
  & $VenvPython $ProbeScript --require-torch-device cuda
  $ProbeExitCode = $LASTEXITCODE
} elseif ($InstallExitCode -eq 0) {
  & $VenvPython $ProbeScript --require-gpu
  $ProbeExitCode = $LASTEXITCODE
} else {
  $ProbeExitCode = $InstallExitCode
}

if ($ProbeExitCode -ne 0 -and $AutoRequested -and $Backend -eq "cuda") {
  Write-Warning "CUDA did not pass the PyTorch tensor probe. Switching to pinned PyTorch CPU."
  & $VenvPython -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml | Out-Host
  $InstallExitCode = Install-Lock "requirements-acceleration-cpu.lock"
  if ($InstallExitCode -eq 0) {
    & $VenvPython $ProbeScript --require-torch-device cpu
    $ProbeExitCode = $LASTEXITCODE
    if ($ProbeExitCode -eq 0) { $Backend = "cpu" }
  } else {
    $ProbeExitCode = $InstallExitCode
  }
}

if ($ProbeExitCode -ne 0 -and $AutoRequested) {
  Write-Warning "The selected GPU runtime did not pass a real inference probe. Switching to ONNX CPU."
  & $VenvPython -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml | Out-Host
  $InstallExitCode = Install-Lock "requirements-acceleration-cpu.lock"
  if ($InstallExitCode -ne 0) {
    throw "CPU runtime installation failed. Browser/theory mode remains available."
  }
  & $VenvPython $ProbeScript --require-torch-device cpu
  if ($LASTEXITCODE -ne 0) {
    throw "CPU runtime verification failed. Browser/theory mode remains available."
  }
  $Backend = "cpu"
} elseif ($ProbeExitCode -ne 0) {
  throw "The GPU runtime did not pass a real inference probe. The basic app remains available on CPU."
}

Write-Host "Acceleration setup finished. Restart .\scripts\dev.ps1 or .\scripts\serve-lan.ps1."
