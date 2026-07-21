$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"

. (Join-Path $ProjectDir "scripts\runtime.ps1")
Import-ProjectEnvironment -ProjectDir $ProjectDir
Assert-NodeRuntime
$PackageManager = Get-PackageManager -ProjectDir $ProjectDir

$AppHost = if ($env:APP_HOST) { $env:APP_HOST } else { "127.0.0.1" }
$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { "8765" }
$FrontendHost = if ($env:MTC_FRONTEND_HOST) { $env:MTC_FRONTEND_HOST } else { "127.0.0.1" }
$FrontendPort = if ($env:MTC_FRONTEND_PORT) { $env:MTC_FRONTEND_PORT } else { "5173" }
$BackendEnabled = if ($env:MTC_BACKEND_ENABLED) { $env:MTC_BACKEND_ENABLED } else { "1" }
$Backend = $null

if (
  $BackendEnabled -ne "0" -and
  (Test-Path $VenvPython)
) {
  & $VenvPython -c "import uvicorn" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $BackendArgs = @(
      "-m", "uvicorn", "app.main:app",
      "--host", $AppHost, "--port", $AppPort,
      "--reload-dir", ".", "--reload"
    )
    $Backend = Start-Process `
      -FilePath $VenvPython `
      -ArgumentList $BackendArgs `
      -WorkingDirectory (Join-Path $ProjectDir "backend") `
      -PassThru `
      -NoNewWindow
    Write-Host "Local inference server: http://${AppHost}:${AppPort} (optional)"
  }
}

if ($null -eq $Backend) {
  Write-Warning "Local inference server is unavailable; continuing in browser/theory mode."
  Write-Warning "Run .\scripts\setup.ps1 to enable the CPU backend."
}

try {
  Write-Host "Web app: http://${FrontendHost}:${FrontendPort}"
  Invoke-FrontendScript `
    -PackageManager $PackageManager `
    -ProjectDir $ProjectDir `
    -ScriptName "dev" `
    -AdditionalArguments @("--host", $FrontendHost, "--port", $FrontendPort)
} finally {
  if ($null -ne $Backend -and -not $Backend.HasExited) {
    Stop-Process -Id $Backend.Id
  }
}
