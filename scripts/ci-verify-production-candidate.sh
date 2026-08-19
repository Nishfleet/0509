#!/usr/bin/env bash
set -euo pipefail

canonical_repository="Nishfleet/0509"
canonical_ref="refs/heads/main"
sha_pattern='^[a-f0-9]{40}$'
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

fail() {
  printf 'production_candidate_invalid: %s\n' "$1" >&2
  exit 1
}

: "${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REF:?GITHUB_REF is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${PINNED_SHA:?PINNED_SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

[[ "$GITHUB_REPOSITORY" == "$canonical_repository" ]] || fail "repository"
[[ "$GITHUB_REF" == "$canonical_ref" ]] || fail "ref"
[[ "$GITHUB_SHA" =~ $sha_pattern ]] || fail "event_sha"
[[ "$PINNED_SHA" =~ $sha_pattern ]] || fail "pinned_sha"
[[ "$GITHUB_RUN_ATTEMPT" == "1" ]] || fail "run_attempt"

case "$GITHUB_EVENT_NAME" in
  push)
    [[ "$GITHUB_SHA" == "$PINNED_SHA" ]] || fail "event_sha_mismatch"
    [[ -z "${EXPECTED_SHA:-}" ]] || fail "unexpected_push_expected_sha"
    ;;
  schedule)
    # Unattended backup/restore pins whatever main tip the run started on.
    # expected_sha must stay empty so nothing can smuggle a chosen commit.
    [[ "$GITHUB_SHA" == "$PINNED_SHA" ]] || fail "event_sha_mismatch"
    [[ -z "${EXPECTED_SHA:-}" ]] || fail "unexpected_schedule_expected_sha"
    ;;
  workflow_dispatch)
    [[ "${EXPECTED_SHA:-}" =~ $sha_pattern ]] || fail "expected_sha"
    # Dispatch resolution: the authorize job pins the exact dispatched
    # candidate, not the run head (GITHUB_SHA is main's tip when the run was
    # created, which can be newer if main advanced between dispatch and run
    # start). The pin must equal the dispatched candidate - the provider CAS
    # below confirms it is still reachable from live main before anything
    # ships. A rewind/rewrite (candidate not an ancestor of the live tip)
    # stays fail-closed.
    [[ "$EXPECTED_SHA" == "$PINNED_SHA" ]] || fail "dispatch_sha_mismatch"
    ;;
  *)
    fail "event"
    ;;
esac

head_sha="$(git rev-parse --verify HEAD)"
[[ "$head_sha" =~ $sha_pattern ]] || fail "head_sha"
[[ "$head_sha" == "$PINNED_SHA" ]] || fail "head_mismatch"
if git symbolic-ref --quiet HEAD >/dev/null 2>&1; then
  fail "checkout_not_detached"
fi

"$script_dir/ci-verify-provider-main-cas.sh" || fail "provider_main_cas"

if [[ "${EMIT_PINNED_SHA:-0}" == "1" ]]; then
  : "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required when EMIT_PINNED_SHA=1}"
  printf 'sha=%s\n' "$PINNED_SHA" >> "$GITHUB_OUTPUT"
fi

printf 'Production candidate pinned at %s.\n' "$PINNED_SHA"
