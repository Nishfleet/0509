#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_command="${AUTORESEARCH_BUILD_COMMAND:-npm run build}"
install_command="${AUTORESEARCH_INSTALL_COMMAND:-npm ci --include=dev --no-audit --no-fund}"
dependency_marker_dir="${AUTORESEARCH_DEPENDENCY_MARKER_DIR:-node_modules}"

cd "$repo_root"

log_file="$(mktemp -t 0509-autoresearch-build.XXXXXX)"
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

run_clean_command() {
  env -u NODE_ENV bash -lc "$1"
}

ensure_dependencies() {
  if [ -d "$repo_root/$dependency_marker_dir" ]; then
    return
  fi

  if [ -f "$repo_root/package-lock.json" ]; then
    run_clean_command "$install_command"
    return
  fi

  if [ -f "$repo_root/package.json" ]; then
    run_clean_command "npm install --include=dev --no-audit --no-fund"
  fi
}

start_ms="$(node -e 'console.log(Date.now())')"

ensure_dependencies

if run_clean_command "$build_command" >"$log_file" 2>&1; then
  end_ms="$(node -e 'console.log(Date.now())')"
  duration_sec="$(node -e 'const [startMs, endMs] = process.argv.slice(1).map(Number); console.log(((endMs - startMs) / 1000).toFixed(3));' "$start_ms" "$end_ms")"

  cat "$log_file" >&2
  printf 'METRIC next_build_duration_sec=%s\n' "$duration_sec"
else
  cat "$log_file" >&2 || true
  exit 1
fi
