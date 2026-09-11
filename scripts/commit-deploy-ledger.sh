#!/usr/bin/env bash
# Append this deploy's row to deploy-ledger.jsonl on top of live origin/main
# and push it back — the same sanctioned bot-commit path quality-ratchet.yml
# already uses (contents: write on the job + x-access-token remote URL +
# plain `git push`).
#
# The ledger row is written WITHOUT touching the deploy checkout's working
# tree or index: a temporary index rebuilds the live main tip's tree with the
# appended file via plumbing (read-tree -> hash-object -> update-index ->
# write-tree -> commit-tree), then `git push <commit>:refs/heads/main` lets
# the server's fast-forward check arbitrate. A merge landing mid-push rejects
# non-ff and the loop retries on the new tip.
#
# Failure policy: after all retries the step WARNS and exits 0. The deploy
# itself already shipped, so failing the run would trip auto-revert on a good
# release; the anchor chain still has the runs API (primary) and this file is
# only the last-resort recovery source before the operator bootstrap.
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

# version_id is informational: the wrangler output file is guaranteed by the
# "Verify complete release evidence set" step, but an unreadable entry must
# not block the row — the anchor chain only needs sha+tree.
version_id=""
shopt -s nullglob
wrangler_outs=(test-results/wrangler-deploy-output-*.jsonl)
if [ "${#wrangler_outs[@]}" -ge 1 ]; then
  version_id="$(
    node scripts/deploy-ledger.mjs version-id "${wrangler_outs[0]}" ||
      true
  )"
  version_id="${version_id%$'\n'}"
fi

row="$(node scripts/deploy-ledger.mjs row --sha "$PINNED_SHA" --version-id "$version_id")"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# The checkout ran with persist-credentials: false, so the push
# authenticates explicitly with the job's GITHUB_TOKEN through the remote
# URL. The token value never reaches the log or the diff.
git remote set-url origin \
  "https://x-access-token:${GH_PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

attempts=3
for attempt in $(seq 1 "$attempts"); do
  index_file="$RUNNER_TEMP/deploy-ledger-index-${attempt}"
  ledger_content="$RUNNER_TEMP/deploy-ledger-${attempt}.jsonl"
  rm -f -- "$index_file"
  # Any failure inside one attempt — a push racing a newer tip OR a plumbing
  # error — retries on a fresh fetch, then warns and exits 0: the deploy
  # already shipped, so a nonzero here would trip auto-revert on a good
  # release.
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
  printf '::warning::deploy-ledger push attempt %s raced a newer main tip or hit a plumbing error; rebuilding on the live tip and retrying.\n' \
    "$attempt" >&2
done

printf '::error::deploy-ledger push failed after %s attempts: deploy %s is live but unrecorded. The anchor chain falls back to the runs API; investigate before the next history rewrite.\n' \
  "$attempts" "$PINNED_SHA" >&2
exit 0
