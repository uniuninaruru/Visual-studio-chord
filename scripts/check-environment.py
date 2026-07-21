#!/usr/bin/env python3
"""Cross-platform, side-effect-free diagnostics for local development.

The basic browser/theory mode and deterministic CPU API never require a GPU.
Missing optional runtimes are reported as fallbacks rather than startup errors.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
SUPPORTED_API_VERSION = "1"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SUPPORTED_PYTHON = ((3, 11), (3, 15))
VALID_INFERENCE_MODES = {"auto", "linear", "mlp", "onnx", "mock-deterministic"}
VALID_PACKAGE_MANAGERS = {"auto", "npm", "pnpm"}
MODEL_EXTENSIONS = {".onnx", ".pt", ".pth", ".safetensors"}


def parse_version(value: str) -> tuple[int, ...] | None:
    match = re.search(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups(default="0"))


def read_pin(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def parse_dotenv(path: Path) -> tuple[dict[str, str], list[str]]:
    """Parse simple dotenv assignments without executing their contents."""

    values: dict[str, str] = {}
    warnings: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return values, warnings

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            warnings.append(f"line {line_number} is not KEY=VALUE")
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            warnings.append(f"line {line_number} has an invalid key")
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values, warnings


def merged_environment(project_root: Path) -> tuple[dict[str, str], list[str]]:
    file_values, warnings = parse_dotenv(project_root / ".env")
    result = file_values.copy()
    result.update(os.environ)
    return result, warnings


def command_output(command: Iterable[str], timeout: float = 4.0) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            list(command),
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return 1, ""
    output = completed.stdout.strip() or completed.stderr.strip()
    return completed.returncode, output


def make_check(
    identifier: str,
    status: str,
    summary: str,
    *,
    details: dict[str, Any] | None = None,
    action: str | None = None,
    optional: bool = False,
) -> dict[str, Any]:
    return {
        "id": identifier,
        "status": status,
        "summary": summary,
        "details": details or {},
        "action": action,
        "optional": optional,
    }


def check_runtime_version(
    *,
    name: str,
    executable: str,
    expected: str | None,
    strict_versions: bool,
    minimum: tuple[int, ...] | None = None,
    maximum: tuple[int, ...] | None = None,
) -> dict[str, Any]:
    path = shutil.which(executable)
    if path is None:
        return make_check(
            name,
            "error",
            f"{name} is not installed.",
            action=f"Install the version recorded for {name}, then rerun setup.",
        )

    return_code, raw_version = command_output([path, "--version"])
    version = parse_version(raw_version)
    if return_code != 0 or version is None:
        return make_check(
            name,
            "error",
            f"{name} did not report a usable version.",
            action=f"Repair the {name} installation and retry.",
        )

    details = {"version": ".".join(map(str, version)), "expected": expected}
    if minimum is not None and version < minimum:
        return make_check(
            name,
            "error",
            f"{name} {details['version']} is too old.",
            details=details,
            action=f"Install {expected or 'a supported version'}.",
        )
    if maximum is not None and version >= maximum:
        return make_check(
            name,
            "error",
            f"{name} {details['version']} is not in the supported range.",
            details=details,
            action=f"Install {expected or 'a supported version'}.",
        )

    expected_version = parse_version(expected or "")
    if expected_version is not None and version != expected_version:
        return make_check(
            name,
            "error" if strict_versions else "warning",
            f"{name} works, but differs from the reproducible project pin.",
            details=details,
            action=f"Use {expected} for results identical to CI.",
        )
    return make_check(name, "ok", f"{name} {details['version']} matches the project pin.", details=details)


def check_javascript_tools(project_root: Path, strict_versions: bool) -> list[dict[str, Any]]:
    node_pin = read_pin(project_root / ".node-version")
    checks = [
        check_runtime_version(
            name="node",
            executable="node",
            expected=node_pin,
            strict_versions=strict_versions,
            minimum=(24, 14, 0),
            maximum=(25, 0, 0),
        )
    ]

    npm_path = shutil.which("npm")
    pnpm_path = shutil.which("pnpm")
    if npm_path is None and pnpm_path is None:
        checks.append(
            make_check(
                "packageManager",
                "error",
                "Neither npm nor pnpm is installed.",
                action="Install Node.js with npm, or install pnpm 11.9.0.",
            )
        )
        return checks

    manager_details: dict[str, str] = {}
    manager_warnings: list[str] = []
    if npm_path is not None:
        code, value = command_output([npm_path, "--version"])
        if code == 0:
            manager_details["npm"] = value
            if parse_version(value) != (11, 9, 0):
                manager_warnings.append("npm differs from 11.9.0")
    if pnpm_path is not None:
        code, value = command_output([pnpm_path, "--version"])
        if code == 0:
            manager_details["pnpm"] = value
            if parse_version(value) != (11, 9, 0):
                manager_warnings.append("pnpm differs from 11.9.0")

    status = "error" if strict_versions and manager_warnings else "warning" if manager_warnings else "ok"
    checks.append(
        make_check(
            "packageManager",
            status,
            "A supported JavaScript package manager is available."
            if not manager_warnings
            else "The package manager works, but differs from the recorded version.",
            details=manager_details,
            action="Use npm 11.9.0 or pnpm 11.9.0 for results identical to CI."
            if manager_warnings
            else None,
        )
    )
    return checks


def check_lockfiles(project_root: Path) -> dict[str, Any]:
    required = [
        "package-lock.json",
        "pnpm-lock.yaml",
        "backend/pyproject.toml",
        "backend/requirements.runtime.lock",
        "backend/requirements.lock",
        "backend/requirements-acceleration-cpu.lock",
        "backend/requirements-acceleration-cuda.lock",
        "backend/requirements-acceleration-directml.lock",
        "backend/requirements-acceleration-macos.lock",
        "backend/uv.lock",
    ]
    missing = [relative for relative in required if not (project_root / relative).is_file()]
    if missing:
        return make_check(
            "dependencyLocks",
            "error",
            "One or more reproducibility files are missing.",
            details={"missing": missing},
            action="Restore the lockfiles from Git before installing dependencies.",
        )
    try:
        package_lock = json.loads((project_root / "package-lock.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return make_check(
            "dependencyLocks",
            "error",
            "package-lock.json is invalid.",
            action="Regenerate it with the recorded npm version and commit the result.",
        )
    if package_lock.get("lockfileVersion") != 3:
        return make_check(
            "dependencyLocks",
            "error",
            "package-lock.json uses an unsupported lock format.",
            details={"lockfileVersion": package_lock.get("lockfileVersion")},
            action="Regenerate it with npm 11.9.0.",
        )
    return make_check(
        "dependencyLocks",
        "ok",
        "npm, pnpm, and Python dependency locks are present.",
        details={"npmLockfileVersion": 3},
    )


def venv_python(project_root: Path) -> Path:
    if os.name == "nt":
        return project_root / ".venv" / "Scripts" / "python.exe"
    return project_root / ".venv" / "bin" / "python"


def check_python_environment(
    project_root: Path,
    strict_versions: bool,
    require_installed: bool,
) -> list[dict[str, Any]]:
    python_pin = read_pin(project_root / ".python-version")
    running_version = platform.python_version()
    version = sys.version_info[:3]
    version_status = "ok"
    version_action = None
    version_summary = f"Python {running_version} is supported."
    if not (SUPPORTED_PYTHON[0] <= version[:2] < SUPPORTED_PYTHON[1]):
        version_status = "error"
        version_summary = f"Python {running_version} is not supported."
        version_action = f"Install Python {python_pin or '3.12'} and rerun setup."
    elif python_pin and parse_version(python_pin) != version:
        version_status = "error" if strict_versions else "warning"
        version_summary = "Python works, but differs from the reproducible project pin."
        version_action = f"Use Python {python_pin} for results identical to CI."
    checks = [
        make_check(
            "python",
            version_status,
            version_summary,
            details={"version": running_version, "expected": python_pin},
            action=version_action,
        )
    ]

    executable = venv_python(project_root)
    if not executable.is_file():
        checks.append(
            make_check(
                "pythonEnvironment",
                "error" if require_installed else "warning",
                "The project virtual environment has not been created.",
                action="Run the platform setup script. Browser-only mode remains available.",
                optional=not require_installed,
            )
        )
        return checks

    probe = (
        "import importlib.metadata as m,json; "
        "names=['fastapi','uvicorn','pytest','ruff','music-theory-composer-backend']; "
        "out={}; "
        "[(out.__setitem__(n, m.version(n)) if True else None) for n in names]; "
        "print(json.dumps(out))"
    )
    code, raw = command_output([str(executable), "-c", probe], timeout=8.0)
    if code != 0:
        checks.append(
            make_check(
                "pythonEnvironment",
                "error" if require_installed else "warning",
                "The virtual environment is incomplete or inconsistent.",
                action="Rerun the setup script; it will not delete project data.",
                optional=not require_installed,
            )
        )
        return checks
    try:
        packages = json.loads(raw)
    except json.JSONDecodeError:
        packages = {}
    checks.append(
        make_check(
            "pythonEnvironment",
            "ok",
            "The pinned CPU backend and test dependencies are installed.",
            details={"python": str(executable), "packages": packages},
        )
    )
    return checks


def check_environment_file(
    project_root: Path,
    environment: dict[str, str],
    parse_warnings: list[str],
) -> list[dict[str, Any]]:
    env_path = project_root / ".env"
    checks: list[dict[str, Any]] = []
    if not env_path.is_file():
        checks.append(
            make_check(
                "environmentFile",
                "warning",
                ".env is absent; safe built-in defaults will be used.",
                action="Run setup to copy .env.example, then edit only the values you need.",
                optional=True,
            )
        )
    elif parse_warnings:
        checks.append(
            make_check(
                "environmentFile",
                "error",
                ".env contains malformed entries.",
                details={"problems": parse_warnings},
                action="Correct the listed KEY=VALUE entries. No file was changed.",
            )
        )
    else:
        checks.append(make_check("environmentFile", "ok", ".env was parsed without executing it."))

    problems: list[str] = []
    for key, default in (("APP_PORT", "8765"), ("MTC_FRONTEND_PORT", "5173")):
        raw = environment.get(key, default)
        try:
            port = int(raw)
        except ValueError:
            problems.append(f"{key} must be an integer")
        else:
            if not 1 <= port <= 65535:
                problems.append(f"{key} must be between 1 and 65535")
    mode = environment.get("MTC_INFERENCE_MODEL", "auto")
    if mode not in VALID_INFERENCE_MODES:
        problems.append("MTC_INFERENCE_MODEL is invalid")
    manager = environment.get("MTC_PACKAGE_MANAGER", "auto")
    if manager not in VALID_PACKAGE_MANAGERS:
        problems.append("MTC_PACKAGE_MANAGER must be auto, npm, or pnpm")
    shared_token = environment.get("MTC_SHARED_TOKEN", "")
    if shared_token and not re.fullmatch(r"[A-Za-z0-9_-]{16,512}", shared_token):
        problems.append("MTC_SHARED_TOKEN must be 16-512 base64url-safe characters")
    raw_timeout = environment.get("MTC_DIAGNOSTICS_TIMEOUT_SECONDS", "1.5")
    try:
        diagnostics_timeout = float(raw_timeout)
    except ValueError:
        problems.append("MTC_DIAGNOSTICS_TIMEOUT_SECONDS must be a number")
    else:
        if not 0.1 <= diagnostics_timeout <= 30:
            problems.append("MTC_DIAGNOSTICS_TIMEOUT_SECONDS must be between 0.1 and 30")
    checks.append(
        make_check(
            "configuration",
            "error" if problems else "ok",
            "Environment configuration has invalid values."
            if problems
            else "Ports and runtime selection are valid.",
            details={"problems": problems},
            action="Compare .env with .env.example and correct the listed values." if problems else None,
        )
    )
    return checks


def check_models(project_root: Path, environment: dict[str, str]) -> dict[str, Any]:
    configured = Path(environment.get("MODEL_DIRECTORY", "./models"))
    model_directory = configured if configured.is_absolute() else project_root / configured
    try:
        models = sorted(
            path.name
            for path in model_directory.iterdir()
            if path.is_file() and path.suffix.lower() in MODEL_EXTENSIONS
        )
    except OSError:
        models = []
    return make_check(
        "models",
        "ok",
        "Built-in deterministic CPU and embedded ONNX models are available."
        if not models
        else f"Found {len(models)} optional external model file(s).",
        details={"directory": str(model_directory), "files": models[:50], "externalRequired": False},
        action=None,
        optional=True,
    )


def check_acceleration(project_root: Path) -> dict[str, Any]:
    executable = venv_python(project_root)
    if not executable.is_file():
        executable = Path(sys.executable)
    probe_script = project_root / "scripts" / "verify_acceleration.py"
    code, raw = command_output([str(executable), str(probe_script), "--json"], timeout=20.0)
    if code != 0:
        return make_check(
            "inferenceRuntime",
            "warning",
            "Optional accelerator diagnostics could not complete.",
            action="Use CPU/browser mode, or open diagnostics after installing an optional runtime.",
            optional=True,
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    selected = data.get("selectedRuntime", "deterministic-cpu")
    gpu_available = bool(data.get("gpuAvailable"))
    return make_check(
        "inferenceRuntime",
        "ok",
        f"Inference runtime: {selected}."
        + (" GPU probe passed." if gpu_available else " CPU fallback is available; GPU is optional."),
        details=data,
        optional=True,
    )


def check_nvidia_driver() -> dict[str, Any]:
    executable = shutil.which("nvidia-smi")
    if executable is None:
        return make_check(
            "nvidiaDriver",
            "ok",
            "No NVIDIA driver tool was detected; CUDA remains optional.",
            details={"detected": False},
            optional=True,
        )
    code, raw = command_output(
        [
            executable,
            "--query-gpu=name,driver_version,memory.total",
            "--format=csv,noheader,nounits",
        ],
        timeout=8.0,
    )
    if code != 0:
        return make_check(
            "nvidiaDriver",
            "warning",
            "An NVIDIA tool exists, but the driver probe failed.",
            action="Continue with CPU mode or repair the NVIDIA driver before enabling CUDA.",
            optional=True,
        )
    return make_check(
        "nvidiaDriver",
        "ok",
        "The NVIDIA driver responded; runtime inference must still pass its own probe.",
        details={"devices": [line.strip() for line in raw.splitlines() if line.strip()]},
        optional=True,
    )


def check_backend(
    environment: dict[str, str],
    *,
    backend_url: str | None,
    timeout: float,
    skip_backend: bool,
) -> dict[str, Any]:
    if skip_backend:
        return make_check(
            "backendConnection",
            "ok",
            "Backend connection check was intentionally skipped.",
            optional=True,
        )
    base_url = backend_url or environment.get("VITE_INFERENCE_SERVER_URL")
    if not base_url:
        port = environment.get("APP_PORT", "8765")
        base_url = f"http://127.0.0.1:{port}"
    url = base_url.rstrip("/") + "/api/health"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
            header_version = response.headers.get("X-API-Version")
    except (OSError, ValueError, urllib.error.URLError):
        return make_check(
            "backendConnection",
            "warning",
            "The local inference server is not connected.",
            details={"url": url, "dataSafe": True, "fallback": "browser/theory"},
            action="Start the backend, retry later, or continue in browser/theory mode.",
            optional=True,
        )
    payload_version = str(payload.get("apiVersion", ""))
    if header_version != SUPPORTED_API_VERSION or payload_version != SUPPORTED_API_VERSION:
        return make_check(
            "backendConnection",
            "warning",
            "The local server uses an incompatible API version.",
            details={
                "url": url,
                "headerApiVersion": header_version,
                "payloadApiVersion": payload_version,
                "expected": SUPPORTED_API_VERSION,
                "dataSafe": True,
                "fallback": "browser/theory",
            },
            action="Update the frontend and backend together, or continue in browser mode.",
            optional=True,
        )
    return make_check(
        "backendConnection",
        "ok",
        "The local inference server and API contract are compatible.",
        details={
            "url": url,
            "apiVersion": payload_version,
            "runtime": payload.get("runtime"),
            "backend": payload.get("backend"),
            "mock": payload.get("mock"),
        },
        optional=True,
    )


def summarize(checks: list[dict[str, Any]]) -> tuple[str, int]:
    required_errors = [check for check in checks if check["status"] == "error" and not check["optional"]]
    if required_errors:
        return "blocked", 1
    fallbacks = [check for check in checks if check["status"] in {"warning", "error"}]
    return ("ready-with-fallback" if fallbacks else "ready"), 0


def render_human(report: dict[str, Any]) -> str:
    symbols = {"ok": "OK", "warning": "WARN", "error": "ERROR"}
    lines = [f"Environment: {report['overall']}"]
    for check in report["checks"]:
        lines.append(f"[{symbols[check['status']]}] {check['summary']}")
        if check.get("action"):
            lines.append(f"  Action: {check['action']}")
    return "\n".join(lines)


def build_report(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    environment, parse_warnings = merged_environment(PROJECT_ROOT)
    if args.timeout is not None:
        backend_timeout = args.timeout
    else:
        try:
            backend_timeout = float(environment.get("MTC_DIAGNOSTICS_TIMEOUT_SECONDS", "1.5"))
        except ValueError:
            backend_timeout = 1.5
        if not 0.1 <= backend_timeout <= 30:
            backend_timeout = 1.5
    checks: list[dict[str, Any]] = []
    checks.append(
        make_check(
            "platform",
            "ok",
            f"Detected {platform.system()} {platform.machine()}.",
            details={
                "system": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
            },
        )
    )
    checks.extend(check_javascript_tools(PROJECT_ROOT, args.strict_versions))
    checks.append(check_lockfiles(PROJECT_ROOT))
    checks.extend(
        check_python_environment(PROJECT_ROOT, args.strict_versions, args.require_installed)
    )
    checks.extend(check_environment_file(PROJECT_ROOT, environment, parse_warnings))
    checks.append(check_models(PROJECT_ROOT, environment))
    checks.append(check_nvidia_driver())
    checks.append(check_acceleration(PROJECT_ROOT))
    checks.append(
        check_backend(
            environment,
            backend_url=args.backend_url,
            timeout=backend_timeout,
            skip_backend=args.skip_backend,
        )
    )
    overall, exit_code = summarize(checks)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "overall": overall,
        "requiredReady": exit_code == 0,
        "checks": checks,
    }, exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print machine-readable output")
    parser.add_argument(
        "--strict-versions",
        action="store_true",
        help="fail when Node, Python, npm, or pnpm differs from the recorded pin",
    )
    parser.add_argument(
        "--require-installed",
        action="store_true",
        help="require the local Python virtual environment and core dependencies",
    )
    parser.add_argument("--skip-backend", action="store_true", help="skip the local API request")
    parser.add_argument("--backend-url", help="override the local API base URL for this probe")
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="override the local API timeout in seconds",
    )
    args = parser.parse_args()
    if args.timeout is not None and not 0.1 <= args.timeout <= 30:
        parser.error("--timeout must be between 0.1 and 30 seconds")

    report, exit_code = build_report(args)
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else render_human(report))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
