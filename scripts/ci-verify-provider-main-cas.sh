#!/usr/bin/env bash
set -euo pipefail

canonical_repository="Nishfleet/0509"
canonical_ref="refs/heads/main"
sha_pattern='^[a-f0-9]{40}$'

fail() {
  printf 'provider_main_cas_invalid: %s\n' "$1" >&2
  exit 1
}

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REF:?GITHUB_REF is required}"
: "${PINNED_SHA:?PINNED_SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

[[ "$GITHUB_REPOSITORY" == "$canonical_repository" ]] || fail "repository"
[[ "$GITHUB_REF" == "$canonical_ref" ]] || fail "ref"
[[ "$PINNED_SHA" =~ $sha_pattern ]] || fail "pinned_sha"

head_sha="$(git rev-parse --verify HEAD)"
[[ "$head_sha" == "$PINNED_SHA" ]] || fail "head_mismatch"
if git symbolic-ref --quiet HEAD >/dev/null 2>&1; then
  fail "checkout_not_detached"
fi

command -v curl >/dev/null 2>&1 || fail "curl_unavailable"
command -v jq >/dev/null 2>&1 || fail "jq_unavailable"
remote_sha="$(
  {
    printf 'url = "https://api.github.com/repos/%s/git/ref/heads/main"\n' \
      "$GITHUB_REPOSITORY"
    printf 'request = "GET"\n'
    printf 'header = "Accept: application/vnd.github+json"\n'
    printf 'header = "X-GitHub-Api-Version: 2026-03-10"\n'
    printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN"
    printf 'fail\n'
    printf 'silent\n'
    printf 'show-error\n'
  } |
    curl --disable \
      --connect-timeout 10 \
      --max-time 30 \
      --proto '=https' \
      --proto-redir '=https' \
      --config - |
    jq -er '.object.sha'
)" || fail "remote_main_unavailable"
[[ "$remote_sha" =~ $sha_pattern ]] || fail "remote_main_sha"
if [[ "$remote_sha" == "$PINNED_SHA" ]]; then
  printf 'Provider main CAS verified at %s.\n' "$PINNED_SHA"
elif [[ "${TOLERATE_MAIN_DRIFT:-0}" == "1" ]]; then
  # Post-gate drift tolerance: the caller (Deploy production, after its full
  # verification gate) deploys exactly PINNED_SHA, so a mid-run move of main
  # does not change what ships. Record the move and continue with the verified
  # SHA instead of failing the whole run. Every other failure above stays
  # fail-closed even with this flag set; drift is the only downgrade.
  printf 'Deploying pinned SHA %s behind main: provider main moved to %s while the exact candidate was verified.\n' \
    "$PINNED_SHA" "$remote_sha" >&2
else
  fail "remote_main_drift"
fi
