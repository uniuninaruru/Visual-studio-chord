#!/usr/bin/env bash

ensure_node_runtime() {
  if command -v node >/dev/null 2>&1 &&
    { command -v pnpm >/dev/null 2>&1 || command -v npm >/dev/null 2>&1; }; then
    return 0
  fi

  local codex_dependencies="${CODEX_BUNDLED_DEPENDENCIES:-${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies}"
  local codex_node_dir="$codex_dependencies/node/bin"
  local codex_override_dir="$codex_dependencies/bin/override"
  local codex_fallback_dir="$codex_dependencies/bin/fallback"

  if [[ -x "$codex_node_dir/node" && -x "$codex_fallback_dir/pnpm" ]]; then
    export PATH="$codex_node_dir:$codex_override_dir:$codex_fallback_dir:$PATH"
  fi
}
