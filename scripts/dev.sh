#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
ensure_node_runtime
PACKAGE_MANAGER="$(select_package_manager "$PROJECT_DIR")"

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8765}"
FRONTEND_HOST="${MTC_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${MTC_FRONTEND_PORT:-5173}"
BACKEND_ENABLED="${MTC_BACKEND_ENABLED:-1}"
BACKEND_PID=""

if [[ "$BACKEND_ENABLED" != "0" ]] && [[ -x "$VENV_PYTHON" ]] &&
  "$VENV_PYTHON" -c 'import uvicorn' >/dev/null 2>&1; then
  "$VENV_PYTHON" -m uvicorn app.main:app \
    --app-dir "$PROJECT_DIR/backend" \
    --host "$APP_HOST" \
    --port "$APP_PORT" \
    --reload-dir "$PROJECT_DIR/backend" \
    --reload &
  BACKEND_PID=$!
  printf 'Local inference server: http://%s:%s (optional)\n' "$APP_HOST" "$APP_PORT"
else
  printf 'Local inference server is unavailable; continuing in browser/theory mode.\n' >&2
  printf 'Run ./scripts/setup.sh to enable the CPU backend.\n' >&2
fi

cleanup() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

printf 'Web app: http://%s:%s\n' "$FRONTEND_HOST" "$FRONTEND_PORT"
run_frontend_script "$PACKAGE_MANAGER" "$PROJECT_DIR" dev \
  --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
