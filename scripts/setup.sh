#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
ensure_node_runtime

if command -v pnpm >/dev/null 2>&1; then
  (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile)
elif command -v npm >/dev/null 2>&1; then
  (cd "$PROJECT_DIR" && npm install)
else
  printf 'Node.js package manager not found. Install Node.js 22.13+ or run this project from Codex.\n' >&2
  exit 1
fi

python3 -m venv "$PROJECT_DIR/.venv"
"$PROJECT_DIR/.venv/bin/python" -m pip install -e "$PROJECT_DIR/backend[test]"

printf 'Setup complete. Run ./scripts/dev.sh\n'
