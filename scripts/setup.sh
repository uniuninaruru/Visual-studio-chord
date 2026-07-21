#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
ensure_node_runtime
PACKAGE_MANAGER="$(select_package_manager "$PROJECT_DIR")"

if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
  (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile)
else
  (cd "$PROJECT_DIR" && npm ci --no-audit --no-fund)
fi

PYTHON_COMMAND="${MTC_PYTHON:-}"
if [[ -n "$PYTHON_COMMAND" ]]; then
  if ! command -v "$PYTHON_COMMAND" >/dev/null 2>&1; then
    printf 'MTC_PYTHON points to a Python executable that was not found.\n' >&2
    exit 1
  fi
else
  PINNED_PYTHON="$(tr -d '[:space:]' < "$PROJECT_DIR/.python-version")"
  PINNED_SELECTOR="${PINNED_PYTHON%.*}"
  for CANDIDATE in "python$PINNED_SELECTOR" python3.13 python3.11 python3.14 python3; do
    if command -v "$CANDIDATE" >/dev/null 2>&1 &&
      "$CANDIDATE" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)' >/dev/null 2>&1; then
      PYTHON_COMMAND="$CANDIDATE"
      break
    fi
  done
fi

if [[ -z "$PYTHON_COMMAND" ]] ||
  ! "$PYTHON_COMMAND" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)' >/dev/null 2>&1; then
  printf 'No supported Python 3.11-3.14 interpreter was found. Python 3.12.10 is recommended.\n' >&2
  printf 'Install the version in .python-version or set MTC_PYTHON.\n' >&2
  exit 1
fi

if [[ ! -x "$VENV_PYTHON" ]]; then
  "$PYTHON_COMMAND" -m venv "$VENV_DIR"
fi

if ! "$VENV_PYTHON" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)'; then
  printf 'The existing .venv uses an unsupported Python. Use Python 3.11-3.14 (3.12.10 recommended).\n' >&2
  printf 'The script did not remove or overwrite the existing environment.\n' >&2
  exit 1
fi

"$VENV_PYTHON" -m pip install --disable-pip-version-check \
  "pip==25.0.1" "setuptools==83.0.0"
"$VENV_PYTHON" -m pip install --disable-pip-version-check \
  --requirement "$PROJECT_DIR/backend/requirements.lock"
"$VENV_PYTHON" -m pip install --disable-pip-version-check \
  --no-deps --no-build-isolation --editable "$PROJECT_DIR/backend"

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  printf 'Created .env from .env.example. Existing environment files are never overwritten.\n'
fi

"$VENV_PYTHON" "$PROJECT_DIR/scripts/check-environment.py" --require-installed

printf 'Setup complete. Run ./scripts/dev.sh\n'
