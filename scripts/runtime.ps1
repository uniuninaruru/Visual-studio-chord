function Import-ProjectEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectDir)

  $EnvFile = Join-Path $ProjectDir ".env"
  if (-not (Test-Path $EnvFile)) { return }

  foreach ($RawLine in Get-Content $EnvFile) {
    $Line = $RawLine.Trim()
    if (-not $Line -or $Line.StartsWith("#")) { continue }
    $Separator = $Line.IndexOf("=")
    if ($Separator -lt 1) {
      Write-Warning "Ignoring malformed .env line: $RawLine"
      continue
    }
    $Key = $Line.Substring(0, $Separator).Trim()
    $Value = $Line.Substring($Separator + 1).Trim()
    if ($Key -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
      Write-Warning "Ignoring invalid .env key: $Key"
      continue
    }
    if (
      $Value.Length -ge 2 -and
      (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
       ($Value.StartsWith("'") -and $Value.EndsWith("'")))
    ) {
      $Value = $Value.Substring(1, $Value.Length - 2)
    }
    if ($null -eq [Environment]::GetEnvironmentVariable($Key, "Process")) {
      [Environment]::SetEnvironmentVariable($Key, $Value, "Process")
    }
  }
}

function Assert-NodeRuntime {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install the version in .node-version, then rerun setup."
  }
  & node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 14 ? 0 : 1)' 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Unsupported Node.js version. Use Node.js 24.14 or newer within the 24.x line (the exact pin is in .node-version)."
  }
  if (
    -not (Get-Command npm -ErrorAction SilentlyContinue) -and
    -not (Get-Command pnpm -ErrorAction SilentlyContinue)
  ) {
    throw "npm or pnpm was not found. Node.js installers normally include npm."
  }
}

function Get-PackageManager {
  param([Parameter(Mandatory = $true)][string]$ProjectDir)

  $Requested = if ($env:MTC_PACKAGE_MANAGER) { $env:MTC_PACKAGE_MANAGER } else { "auto" }
  if ($Requested -eq "auto") {
    if (
      (Test-Path (Join-Path $ProjectDir "node_modules\.pnpm")) -and
      (Get-Command pnpm -ErrorAction SilentlyContinue)
    ) { return "pnpm" }
    if (Get-Command npm -ErrorAction SilentlyContinue) { return "npm" }
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { return "pnpm" }
    throw "No supported JavaScript package manager was found."
  }
  if ($Requested -notin @("npm", "pnpm")) {
    throw "MTC_PACKAGE_MANAGER must be auto, npm, or pnpm."
  }
  if (-not (Get-Command $Requested -ErrorAction SilentlyContinue)) {
    throw "Requested package manager '$Requested' was not found."
  }
  return $Requested
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [string[]]$Arguments = @()
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE. Review the preceding output."
  }
}

function Invoke-FrontendScript {
  param(
    [Parameter(Mandatory = $true)][string]$PackageManager,
    [Parameter(Mandatory = $true)][string]$ProjectDir,
    [Parameter(Mandatory = $true)][string]$ScriptName,
    [string[]]$AdditionalArguments = @()
  )

  $FrontendDir = Join-Path $ProjectDir "frontend"
  if ($PackageManager -eq "pnpm") {
    Invoke-Checked -Program "pnpm" -Arguments (@("--dir", $FrontendDir, $ScriptName) + $AdditionalArguments)
  } elseif ($AdditionalArguments.Count -gt 0) {
    Invoke-Checked -Program "npm" -Arguments (@("--prefix", $FrontendDir, "run", $ScriptName, "--") + $AdditionalArguments)
  } else {
    Invoke-Checked -Program "npm" -Arguments @("--prefix", $FrontendDir, "run", $ScriptName)
  }
}
