#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker was not found. Install Docker Desktop or Docker Engine first.\n' >&2
  exit 1
fi

cd "$PROJECT_DIR"

LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
elif command -v hostname >/dev/null 2>&1; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

if [[ -n "$LAN_IP" ]]; then
  printf 'Phone URL (same trusted network): http://%s:5173\n' "$LAN_IP"
else
  printf 'Phone URL: http://<desktop-private-ip>:5173\n'
fi

docker compose up --build
