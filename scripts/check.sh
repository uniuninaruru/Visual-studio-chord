#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v pnpm >/dev/null 2>&1; then
  pnpm --dir "$PROJECT_DIR/frontend" typecheck
  pnpm --dir "$PROJECT_DIR/frontend" lint
  pnpm --dir "$PROJECT_DIR/frontend" test
  pnpm --dir "$PROJECT_DIR/frontend" build
elif command -v npm >/dev/null 2>&1; then
  npm --prefix "$PROJECT_DIR/frontend" run typecheck
  npm --prefix "$PROJECT_DIR/frontend" run lint
  npm --prefix "$PROJECT_DIR/frontend" run test
  npm --prefix "$PROJECT_DIR/frontend" run build
else
  printf 'Node.js package manager not found.\n' >&2
  exit 1
fi

(
  cd "$PROJECT_DIR/backend"
  "$PROJECT_DIR/.venv/bin/python" -m pytest
  "$PROJECT_DIR/.venv/bin/python" -m ruff check app tests
)
