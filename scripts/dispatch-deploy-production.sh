#!/usr/bin/env bash
# Dispatch helper for the "Deploy production" workflow
# (.github/workflows/deploy-production.yml).
#
# On 2026-08-14 three workflow_dispatch runs (31804657640, 31804669687,
# 31804741398) burned red at the Authorize gate because the dispatch tooling
# passed the placeholder SHA aaaa…40 (or an off-main branch commit) as
# expected_sha. The placeholder is valid 40-hex, so
# the workflow's own format check cannot catch it - the guard has to live in
# the dispatch path. This helper is that guard:
#
#   1. It resolves the real main tip from the GitHub API (git ls-remote as a
#      fallback) at dispatch time.
#   2. It fails fast with a clear message if it cannot resolve a real SHA.
#   3. It rejects any candidate that is not exactly 40 lowercase hex chars or
#      that is a sentinel (every character identical, e.g. aaaa... or 0000...).
#   4. Only then does it run `gh workflow run` against main.
#
# Usage:
#   scripts/dispatch-deploy-production.sh [--repo OWNER/NAME] \
#     [--expected-sha <40-hex>] [--backup-proof-status required|deferred] \
#     [--deferred-backup-authorization nish-accepted-no-backup-proof:<sha>] \
#     [--dry-run]
#
# --expected-sha is for dispatching an exact CI-verified candidate; it passes
# the same validation as a resolved main tip. --dry-run prints the exact
# command and exits without touching GitHub.
set -euo pipefail

workflow="deploy-production.yml"
default_repo="Nishfleet/0509"
sha_pattern='^[a-f0-9]{40}$'

fail() {
  printf 'deploy_dispatch_refused: %s\n' "$1" >&2
  exit 1
}

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

is_valid_candidate_sha() {
  local sha="$1"
  [[ "$sha" =~ $sha_pattern ]] || return 1
  # A real commit SHA cannot have every character identical; sentinels like
  # aaaa... are valid hex, so they must be rejected here, not by the workflow.
  local unique
  unique="$(printf '%s' "$sha" | fold -w1 | sort -u | tr -d '\n')"
  [ "${#unique}" -gt 1 ]
}

resolve_main_tip() {
  local repo="$1" sha=""
  if command -v gh >/dev/null 2>&1; then
    sha="$(gh api "repos/$repo/commits/main" --jq .sha 2>/dev/null || true)"
  fi
  if [ -z "$sha" ]; then
    sha="$(git ls-remote "https://github.com/$repo.git" refs/heads/main 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "$sha"
}

main() {
  local repo="$default_repo" expected="" backup_status="required" deferred_auth="" dry_run=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --repo)
        [ "$#" -ge 2 ] || fail "option_requires_value: $1"
        repo="$2"
        shift 2
        ;;
      --expected-sha)
        [ "$#" -ge 2 ] || fail "option_requires_value: $1"
        expected="$2"
        shift 2
        ;;
      --backup-proof-status)
        [ "$#" -ge 2 ] || fail "option_requires_value: $1"
        backup_status="$2"
        shift 2
        ;;
      --deferred-backup-authorization)
        [ "$#" -ge 2 ] || fail "option_requires_value: $1"
        deferred_auth="$2"
        shift 2
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      -h|--help)
        usage
        return 0
        ;;
      *)
        fail "unknown_argument: $1"
        ;;
    esac
  done

  case "$backup_status" in
    required)
      [ -z "$deferred_auth" ] || fail "deferred_authorization_requires_deferred_status"
      ;;
    deferred) ;;
    *)
      fail "invalid_backup_proof_status: $backup_status (required|deferred)"
      ;;
  esac

  if [ -z "$expected" ]; then
    expected="$(resolve_main_tip "$repo")"
    if [ -z "$expected" ]; then
      fail "could_not_resolve_main_tip: refusing to dispatch Deploy production without a real main commit; resolve origin/main manually and pass --expected-sha"
    fi
  fi

  if ! is_valid_candidate_sha "$expected"; then
    fail "invalid_expected_sha: '$expected' is not a real 40-hex main commit (placeholder/sentinel SHAs such as aaaa... are rejected)"
  fi

  if [ "$backup_status" = "deferred" ]; then
    [ "$deferred_auth" = "nish-accepted-no-backup-proof:$expected" ] ||
      fail "invalid_deferred_authorization: must equal nish-accepted-no-backup-proof:$expected"
  fi

  local -a cmd=(gh workflow run "$workflow" --repo "$repo" --ref main
    -f "expected_sha=$expected" -f "backup_proof_status=$backup_status")
  if [ -n "$deferred_auth" ]; then
    cmd+=(-f "deferred_backup_authorization=$deferred_auth")
  fi

  if [ "$dry_run" = "1" ]; then
    printf 'dry-run:'
    printf ' %q' "${cmd[@]}"
    printf '\n'
    return 0
  fi

  "${cmd[@]}"
  printf 'dispatched %s for %s (backup_proof_status=%s)\n' "$workflow" "$expected" "$backup_status"
  printf 'watch it with: gh run list --workflow %s --repo %s --limit 1\n' "$workflow" "$repo"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
