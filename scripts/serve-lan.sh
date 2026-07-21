#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
export MTC_FRONTEND_HOST=0.0.0.0
FRONTEND_PORT="${MTC_FRONTEND_PORT:-5173}"

if [[ -z "${MTC_SHARED_TOKEN:-}" ]]; then
  TOKEN_PYTHON="$PROJECT_DIR/.venv/bin/python"
  if [[ ! -x "$TOKEN_PYTHON" ]]; then
    TOKEN_PYTHON="$(command -v python3 || true)"
  fi
  if [[ -z "$TOKEN_PYTHON" ]]; then
    printf 'Python 3 is required to generate the LAN session token. Run ./scripts/setup.sh first.\n' >&2
    exit 1
  fi
  MTC_SHARED_TOKEN="$($TOKEN_PYTHON -c 'import secrets; print(secrets.token_hex(32))')"
  export MTC_SHARED_TOKEN
fi

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
elif command -v hostname >/dev/null 2>&1; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

printf 'Desktop URL: http://127.0.0.1:%s/#access=%s\n' "$FRONTEND_PORT" "$MTC_SHARED_TOKEN"
if [[ -n "$LAN_IP" ]]; then
  printf 'Phone URL (same trusted network): http://%s:%s/#access=%s\n' "$LAN_IP" "$FRONTEND_PORT" "$MTC_SHARED_TOKEN"
else
  printf 'Phone URL: http://<desktop-private-ip>:%s/#access=%s\n' "$FRONTEND_PORT" "$MTC_SHARED_TOKEN"
fi

[[ "${MTC_LAUNCH_DRY_RUN:-0}" == "1" ]] && exit 0

exec "$PROJECT_DIR/scripts/dev.sh"
