#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

prompt_value="${1:-}"
if [ -z "$prompt_value" ] && [ -t 0 ]; then
  read -r -p "Task slug (for branch/worktree name): " prompt_value || true
fi

task_slug="$(slugify "${prompt_value:-}")"
if [ -z "$task_slug" ]; then
  task_slug="task-$(date +%Y%m%d-%H%M%S)"
fi

repo_slug="$(slugify "$(basename "$ROOT_DIR")")"
base_ref="${CODEX_BASE_REF:-main}"

if git show-ref --verify --quiet "refs/heads/$base_ref"; then
  start_ref="$base_ref"
elif git show-ref --verify --quiet "refs/remotes/origin/$base_ref"; then
  start_ref="origin/$base_ref"
else
  current_branch="$(git branch --show-current 2>/dev/null || true)"
  if [ -z "$current_branch" ]; then
    echo "Unable to determine a base ref for the new worktree." >&2
    exit 1
  fi
  start_ref="$current_branch"
fi

branch_name="work/$(date +%Y%m%d)-$task_slug"
if git show-ref --verify --quiet "refs/heads/$branch_name" || git show-ref --verify --quiet "refs/remotes/origin/$branch_name"; then
  suffix=2
  while git show-ref --verify --quiet "refs/heads/${branch_name}-${suffix}" || git show-ref --verify --quiet "refs/remotes/origin/${branch_name}-${suffix}"; do
    suffix=$((suffix + 1))
  done
  branch_name="${branch_name}-${suffix}"
fi

worktree_root="${CODEX_WORKTREE_ROOT:-$HOME/.config/superpowers/worktrees/$repo_slug}"
mkdir -p "$worktree_root"

worktree_path="$worktree_root/$task_slug"
if [ -e "$worktree_path" ]; then
  suffix=2
  while [ -e "${worktree_path}-${suffix}" ]; do
    suffix=$((suffix + 1))
  done
  worktree_path="${worktree_path}-${suffix}"
fi

echo "Creating worktree ${worktree_path} on ${branch_name} from ${start_ref}..."
git worktree add "$worktree_path" -b "$branch_name" "$start_ref"

if [ -x "$worktree_path/scripts/codex/setup-worktree.sh" ]; then
  (
    cd "$worktree_path"
    ./scripts/codex/setup-worktree.sh
  )
fi

cat <<DONE
Worktree ready at: $worktree_path
Branch: $branch_name
Next:
  cd "$worktree_path"
DONE
