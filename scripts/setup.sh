#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
REQUESTED_ACCELERATION="${1:-}"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
ACCELERATION_MODE="${REQUESTED_ACCELERATION:-${MTC_ACCELERATION:-auto}}"
case "$ACCELERATION_MODE" in
  auto|cuda|mps|cpu|none) ;;
  *)
    printf 'Usage: ./scripts/setup.sh [auto|cuda|mps|cpu|none]\n' >&2
    exit 2
    ;;
esac
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
  # `venv` on a directory that already exists refuses to touch it and exits
  # non-zero, so a virtual environment whose interpreter has gone — the usual
  # cause being a system or Xcode Python that was upgraded or removed out from
  # under it — is never repaired by running this script again. Rebuilding in
  # place is what the user wants and what they cannot get otherwise; --clear
  # discards only the environment, never the project.
  if [[ -e "$VENV_DIR" ]]; then
    printf 'The .venv interpreter is missing, so the environment is being rebuilt.\n' >&2
    if ! "$PYTHON_COMMAND" -m venv --clear "$VENV_DIR"; then
      printf 'Could not rebuild .venv. Delete the directory and run this script again.\n' >&2
      exit 1
    fi
  elif ! "$PYTHON_COMMAND" -m venv "$VENV_DIR"; then
    printf 'Could not create .venv.\n' >&2
    exit 1
  fi
fi

# Report what is actually wrong. A broken environment and one built on the
# wrong Python need different answers, and telling someone to install a
# supported Python when they already have one sends them somewhere useless.
if [[ ! -x "$VENV_PYTHON" ]]; then
  printf 'The .venv interpreter is still missing after a rebuild attempt.\n' >&2
  printf 'Delete the .venv directory and run this script again.\n' >&2
  exit 1
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

if [[ "$ACCELERATION_MODE" == "none" ]]; then
  printf 'PyTorch installation skipped by explicit setup profile "none".\n'
else
  "$PROJECT_DIR/scripts/setup-acceleration.sh" "$ACCELERATION_MODE"
fi

"$VENV_PYTHON" "$PROJECT_DIR/scripts/check-environment.py" --require-installed

printf 'Setup complete. Run ./scripts/dev.sh\n'
