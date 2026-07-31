#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
ensure_node_runtime
PACKAGE_MANAGER="$(select_package_manager "$PROJECT_DIR")"

if [[ ! -x "$VENV_PYTHON" ]]; then
  printf 'Backend test environment not found. Run ./scripts/setup.sh first.\n' >&2
  exit 1
fi

run_frontend_script "$PACKAGE_MANAGER" "$PROJECT_DIR" typecheck
run_frontend_script "$PACKAGE_MANAGER" "$PROJECT_DIR" lint
run_frontend_script "$PACKAGE_MANAGER" "$PROJECT_DIR" test
run_frontend_script "$PACKAGE_MANAGER" "$PROJECT_DIR" build

(
  cd "$PROJECT_DIR/backend"
  "$VENV_PYTHON" -m pytest
  "$VENV_PYTHON" -m ruff check app tests
)

"$VENV_PYTHON" -m unittest discover \
  --start-directory "$PROJECT_DIR/scripts/tests" \
  --pattern 'test_*.py'
"$VENV_PYTHON" "$PROJECT_DIR/scripts/check-private-artifacts.py"
"$VENV_PYTHON" "$PROJECT_DIR/scripts/check-environment.py" --require-installed
