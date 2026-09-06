#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

warn_if_dirty_main() {
  local current_branch

  current_branch="$(git branch --show-current 2>/dev/null || true)"
  case "$current_branch" in
    main|master)
      if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        cat <<'WARN'
Warning: this checkout is dirty on main/master.
Create an isolated task workspace with ./scripts/codex/start-task-worktree.sh
or run ./scripts/codex/normalize-base-checkout.sh to move the current state into a linked worktree
before doing more write work here.
WARN
      fi
      ;;
  esac
}

bootstrap_shared_hooks() {
  local primary_worktree shared_root bootstrap_script

  primary_worktree="$(git worktree list --porcelain | awk '$1 == "worktree" { print substr($0, 10); exit }')"
  if [ -z "$primary_worktree" ]; then
    return
  fi

  shared_root="$(cd "$(dirname "$primary_worktree")" && pwd)"
  bootstrap_script="$shared_root/scripts/bootstrap-shared-hooks.sh"
  if [ -x "$bootstrap_script" ]; then
    "$bootstrap_script" "$primary_worktree" >/dev/null
  fi
}

configure_git_defaults() {
  git config worktree.guessRemote true
  bootstrap_shared_hooks
}

warn_if_dirty_main
configure_git_defaults
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for this repo." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    echo "Installing npm dependencies from package-lock.json..."
    npm ci
  else
    echo "Installing npm dependencies..."
    npm install
  fi
else
  echo "node_modules already present; skipping npm install."
fi
