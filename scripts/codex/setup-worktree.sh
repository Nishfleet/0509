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
        cat <<'EOF'
Warning: this checkout is dirty on main/master.
Create an isolated task workspace with ./scripts/codex/start-task-worktree.sh
or run ./scripts/codex/normalize-base-checkout.sh to move the current state into a linked worktree
before doing more write work here.
EOF
      fi
      ;;
  esac
}

warn_if_dirty_main

configure_git_defaults() {
  git config worktree.guessRemote true
}

configure_git_defaults

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for 0509 worktrees." >&2
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

if [ ! -f .dev.vars ] && [ ! -f .env ] && [ ! -f .env.local ] && [ ! -f .dev.vars.local ]; then
  echo "No local env file detected (.dev.vars or .env*). Dev commands may need one."
fi
