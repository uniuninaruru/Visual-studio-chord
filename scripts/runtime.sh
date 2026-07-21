#!/usr/bin/env bash

load_project_env() {
  local project_dir="$1"
  local env_file="$project_dir/.env"
  local line key value

  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" != *=* ]]; then
      printf 'Ignoring malformed .env line: %s\n' "$line" >&2
      continue
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf 'Ignoring invalid .env key: %s\n' "$key" >&2
      continue
    fi
    if [[ ${#value} -ge 2 ]] &&
      { [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] ||
        [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; }; then
      value="${value:1:${#value}-2}"
    fi
    if ! printenv "$key" >/dev/null 2>&1; then
      export "$key=$value"
    fi
  done < "$env_file"
}

ensure_node_runtime() {
  if ! command -v node >/dev/null 2>&1; then
    printf 'Node.js was not found. Install the version in .node-version, then rerun setup.\n' >&2
    return 1
  fi
  if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 24 && minor >= 14 ? 0 : 1)' >/dev/null 2>&1; then
    printf 'Unsupported Node.js version. Use Node.js 24.14 or newer within the 24.x line (the exact pin is in .node-version).\n' >&2
    return 1
  fi
  if ! command -v pnpm >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
    printf 'npm or pnpm was not found. Node.js installers normally include npm.\n' >&2
    return 1
  fi
}

select_package_manager() {
  local project_dir="$1"
  local requested="${MTC_PACKAGE_MANAGER:-auto}"

  case "$requested" in
    auto)
      if [[ -d "$project_dir/node_modules/.pnpm" ]] && command -v pnpm >/dev/null 2>&1; then
        printf 'pnpm'
      elif command -v npm >/dev/null 2>&1; then
        printf 'npm'
      elif command -v pnpm >/dev/null 2>&1; then
        printf 'pnpm'
      else
        return 1
      fi
      ;;
    npm|pnpm)
      if ! command -v "$requested" >/dev/null 2>&1; then
        printf 'Requested package manager "%s" was not found.\n' "$requested" >&2
        return 1
      fi
      printf '%s' "$requested"
      ;;
    *)
      printf 'MTC_PACKAGE_MANAGER must be auto, npm, or pnpm.\n' >&2
      return 1
      ;;
  esac
}

run_frontend_script() {
  local manager="$1"
  local project_dir="$2"
  local script="$3"
  shift 3

  if [[ "$manager" == "pnpm" ]]; then
    pnpm --dir "$project_dir/frontend" "$script" "$@"
  elif [[ $# -gt 0 ]]; then
    npm --prefix "$project_dir/frontend" run "$script" -- "$@"
  else
    npm --prefix "$project_dir/frontend" run "$script"
  fi
}
