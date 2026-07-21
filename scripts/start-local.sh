#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=runtime.sh
source "$PROJECT_DIR/scripts/runtime.sh"
load_project_env "$PROJECT_DIR"
FRONTEND_PORT="${MTC_FRONTEND_PORT:-5173}"

if [[ -z "${MTC_SHARED_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    MTC_SHARED_TOKEN="$(openssl rand -hex 32)"
  elif command -v python3 >/dev/null 2>&1; then
    MTC_SHARED_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  else
    printf 'A secure token generator was not found. Install OpenSSL or Python 3.\n' >&2
    exit 1
  fi
  export MTC_SHARED_TOKEN
fi

cd "$PROJECT_DIR"

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

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker was not found. Install Docker Desktop or Docker Engine first.\n' >&2
  exit 1
fi

docker compose up --build
