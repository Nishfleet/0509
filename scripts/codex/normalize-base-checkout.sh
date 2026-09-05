#!/usr/bin/env bash

set -euo pipefail

slugify() {
  local input="${1:-task}"
  input="${input// /-}"
  input="$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"
  input="${input#-}"
  input="${input%-}"
  if [ -z "$input" ]; then
    input="task"
  fi
  printf '%s\n' "$input"
}

find_base_branch() {
  if git show-ref --verify --quiet refs/heads/main; then
    printf 'main\n'
    return 0
  fi
  if git show-ref --verify --quiet refs/heads/master; then
    printf 'master\n'
    return 0
  fi
  local remote_head
  remote_head="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [ -n "$remote_head" ]; then
    printf '%s\n' "${remote_head#origin/}"
    return 0
  fi
  return 1
}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

current_branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -z "$current_branch" ]; then
  echo "Detached HEAD is not supported by normalize-base-checkout.sh." >&2
  exit 1
fi

base_branch="$(find_base_branch || true)"
if [ -z "$base_branch" ]; then
  echo "Could not determine a protected base branch (main/master/origin HEAD)." >&2
  exit 1
fi

status_output="$(git status --porcelain)"
is_dirty=0
if [ -n "$status_output" ]; then
  is_dirty=1
fi

if [ "$current_branch" = "$base_branch" ] && [ "$is_dirty" -eq 0 ]; then
  echo "Base checkout is already clean on $base_branch."
  exit 0
fi

repo_name="$(basename "$repo_root")"
worktree_root="${CODEX_WORKTREE_ROOT:-$HOME/.config/superpowers/worktrees/$repo_name}"
mkdir -p "$worktree_root"

timestamp="$(date +%Y%m%d-%H%M%S)"
slug="$(slugify "${1:-base-repair}")"

if [ "$current_branch" = "$base_branch" ]; then
  target_branch="work/${timestamp}-${slug}"
else
  target_branch="$current_branch"
fi

target_leaf="$(printf '%s' "$target_branch" | tr '/:' '--')"
target_path="$worktree_root/$target_leaf"

if [ -e "$target_path" ]; then
  echo "Target worktree path already exists: $target_path" >&2
  exit 1
fi

existing_worktree="$(git worktree list --porcelain | awk -v branch="refs/heads/$target_branch" '
  $1 == "worktree" { wt = substr($0, 10) }
  $1 == "branch" && $2 == branch { print wt; exit }
')"
if [ -n "$existing_worktree" ] && [ "$existing_worktree" != "$repo_root" ]; then
  echo "Branch already has a linked worktree: $target_branch ($existing_worktree)" >&2
  exit 1
fi

stash_ref=""
if [ "$is_dirty" -eq 1 ]; then
  stash_message="codex-normalize-base-$timestamp-$target_branch"
  git stash push --include-untracked -m "$stash_message" >/dev/null
  stash_ref="$(git stash list --format='%gd %gs' | awk -v msg="$stash_message" '$0 ~ msg { print $1; exit }')"
  if [ -z "$stash_ref" ]; then
    echo "Failed to capture a stash for the current checkout state." >&2
    exit 1
  fi
fi

if [ "$current_branch" != "$base_branch" ]; then
  git switch "$base_branch" >/dev/null
fi

if [ "$current_branch" = "$base_branch" ]; then
  git worktree add -b "$target_branch" "$target_path" >/dev/null
else
  git worktree add "$target_path" "$target_branch" >/dev/null
fi

if [ -n "$stash_ref" ]; then
  if ! git -C "$target_path" stash apply "$stash_ref" >/dev/null; then
    echo "Stash apply failed in $target_path. Original stash preserved as $stash_ref." >&2
    exit 1
  fi
  git stash drop "$stash_ref" >/dev/null || true
fi

if [ -x "$target_path/scripts/codex/setup-worktree.sh" ]; then
  "$target_path/scripts/codex/setup-worktree.sh"
fi

echo "Normalized base checkout."
echo "Base checkout: $repo_root ($base_branch)"
echo "Active task worktree: $target_path ($target_branch)"
