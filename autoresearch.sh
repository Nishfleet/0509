#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build_command="${AUTORESEARCH_BUILD_COMMAND:-npm run build}"

cd "$repo_root"

log_file="$(mktemp -t 0509-autoresearch-build.XXXXXX)"
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

start_ms="$(node -e 'console.log(Date.now())')"

if bash -lc "$build_command" >"$log_file" 2>&1; then
  end_ms="$(node -e 'console.log(Date.now())')"
  duration_sec="$(node -e 'const [startMs, endMs] = process.argv.slice(1).map(Number); console.log(((endMs - startMs) / 1000).toFixed(3));' "$start_ms" "$end_ms")"

  cat "$log_file" >&2
  printf 'METRIC next_build_duration_sec=%s\n' "$duration_sec"
else
  cat "$log_file" >&2 || true
  exit 1
fi
