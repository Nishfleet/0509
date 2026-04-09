#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install_command="${AUTORESEARCH_INSTALL_COMMAND:-npm ci --include=dev --no-audit --no-fund}"
dependency_marker_dir="${AUTORESEARCH_DEPENDENCY_MARKER_DIR:-node_modules}"
checks_command="${AUTORESEARCH_CHECKS_COMMAND:-npm run lint}"

cd "$repo_root"

run_clean_command() {
  env -u NODE_ENV bash -lc "$1"
}

if [ ! -d "$repo_root/$dependency_marker_dir" ]; then
  if [ -f "$repo_root/package-lock.json" ]; then
    run_clean_command "$install_command"
  elif [ -f "$repo_root/package.json" ]; then
    run_clean_command "npm install --include=dev --no-audit --no-fund"
  fi
fi

exec env -u NODE_ENV bash -lc "$checks_command"
