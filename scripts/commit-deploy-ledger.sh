#!/usr/bin/env bash
# Append this deploy's row to deploy-ledger.jsonl on top of live origin/main
# and push it back — the same bot-commit path quality-ratchet.yml uses
# (contents: write + x-access-token remote URL + git push). A temporary
# index rebuilds live main's tree with the appended file via plumbing, so
# the deploy checkout's own tree and index are never touched.
#
# One attempt, no retry loop: a lost fast-forward race WARNS and exits 0 —
# the deploy already shipped, so failing here would trip auto-revert on a
# good release, and the anchor chain still has the runs API plus tree-hash
# recovery.
set -euo pipefail

: "${PINNED_SHA:?PINNED_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_PUSH_TOKEN:?GH_PUSH_TOKEN is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

sha_pattern='^[a-f0-9]{40}$'
[[ "$PINNED_SHA" =~ $sha_pattern ]] || {
  printf 'deploy_ledger_sha_invalid\n' >&2
  exit 1
}

# The "Verify complete release evidence set" step guarantees exactly one
# wrangler output file on success; an unreadable one still yields a row
# (version_id is informational — the anchor chain only needs sha+tree).
shopt -s nullglob
wrangler_outs=(test-results/wrangler-deploy-output-*.jsonl)
wrangler_arg=()
if [ "${#wrangler_outs[@]}" -ge 1 ]; then
  wrangler_arg=(--wrangler-output "${wrangler_outs[0]}")
fi

row="$(node scripts/deploy-ledger.mjs row --sha "$PINNED_SHA" "${wrangler_arg[@]}")"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# The checkout ran with persist-credentials: false, so the push
# authenticates explicitly with the job's GITHUB_TOKEN through the remote
# URL. The token value never reaches the log or the diff.
git remote set-url origin \
  "https://x-access-token:${GH_PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

index_file="$RUNNER_TEMP/deploy-ledger-index"
ledger_content="$RUNNER_TEMP/deploy-ledger.jsonl"
rm -f -- "$index_file"
if (
  set -e
  git fetch --quiet origin main
  if git cat-file -e "FETCH_HEAD:deploy-ledger.jsonl" 2>/dev/null; then
    git show "FETCH_HEAD:deploy-ledger.jsonl" > "$ledger_content"
  else
    : > "$ledger_content"
  fi
  printf '%s\n' "$row" >> "$ledger_content"
  blob="$(git hash-object -w -- "$ledger_content")"
  GIT_INDEX_FILE="$index_file" git read-tree FETCH_HEAD
  GIT_INDEX_FILE="$index_file" git update-index --add \
    --cacheinfo "100644,$blob,deploy-ledger.jsonl"
  new_tree="$(GIT_INDEX_FILE="$index_file" git write-tree)"
  rm -f -- "$index_file"
  commit="$(
    git commit-tree "$new_tree" -p FETCH_HEAD \
      -m "chore(deploy): record ${PINNED_SHA} in deploy-ledger.jsonl"
  )"
  git push --quiet origin "${commit}:refs/heads/main"
); then
  printf 'deploy-ledger.jsonl updated on main: records deploy of %s\n' \
    "$PINNED_SHA"
  exit 0
fi

rm -f -- "$index_file"
printf '::error::deploy-ledger push lost the race to a newer main tip: deploy %s is live but unrecorded. The anchor chain falls back to the runs API and tree-hash recovery; investigate before the next history rewrite.\n' \
  "$PINNED_SHA" >&2
exit 0
