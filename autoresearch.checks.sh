#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checks_command="${AUTORESEARCH_CHECKS_COMMAND:-npm run lint}"
install_command="${AUTORESEARCH_INSTALL_COMMAND:-npm ci --include=dev --no-audit --no-fund}"
dependency_marker_dir="${AUTORESEARCH_DEPENDENCY_MARKER_DIR:-node_modules}"

cd "$repo_root"

if [ ! -d "$repo_root/$dependency_marker_dir" ]; then
  if [ -f "$repo_root/package-lock.json" ]; then
    bash -lc "$install_command"
  elif [ -f "$repo_root/package.json" ]; then
    bash -lc "npm install --include=dev --no-audit --no-fund"
  fi
fi

exec bash -lc "$checks_command"
