#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
ensure_node_runtime

if [[ ! -x "$PROJECT_DIR/.venv/bin/uvicorn" ]]; then
  printf 'Backend environment not found. Run ./scripts/setup.sh first.\n' >&2
  exit 1
fi

"$PROJECT_DIR/.venv/bin/python" -m uvicorn app.main:app \
  --app-dir "$PROJECT_DIR/backend" \
  --host 127.0.0.1 \
  --port 8765 \
  --reload &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if command -v pnpm >/dev/null 2>&1; then
  pnpm --dir "$PROJECT_DIR/frontend" dev
elif command -v npm >/dev/null 2>&1; then
  npm --prefix "$PROJECT_DIR/frontend" run dev
else
  printf 'Node.js package manager not found. Run ./scripts/setup.sh first.\n' >&2
  exit 1
fi
