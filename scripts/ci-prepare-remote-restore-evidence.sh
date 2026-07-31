#!/usr/bin/env bash
# Verify pre-generated exact R2 restore evidence and package it for upload.
#
# Must be invoked as argv to deploy-window-lock.sh run — never via
# stdin/heredoc. Verification lanes background the command, so bash redirects
# the lane's stdin to /dev/null and a heredoc body never executes.
#
# Archive path is owned by RESTORE_EVIDENCE_ARCHIVE (job-level env). The
# upload-artifact step must reference ${{ env.RESTORE_EVIDENCE_ARCHIVE }} —
# never a duplicated path literal.
set -euo pipefail
umask 077

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${RESTORE_EVIDENCE_ARCHIVE:?RESTORE_EVIDENCE_ARCHIVE is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

evidence="$RUNNER_TEMP/d1-remote-restore-evidence.json"
manifest="$RUNNER_TEMP/d1-remote-restore-candidate-manifest.json"
cache="$RUNNER_TEMP/d1-remote-restore-evidence-cache"
evidence_valid=false
archive="$RESTORE_EVIDENCE_ARCHIVE"

# Resolve an executable gh even when PATH was stripped before the lane.
# Prefer an explicit GH_BIN, then PATH, then the hardened runner tool root.
resolve_gh_bin() {
  local candidate
  local tool_root="${DEPLOY_WINDOW_TOOL_ROOT:-/opt/0509-runner/bin}"
  if [ -n "${GH_BIN:-}" ]; then
    if [ -x "$GH_BIN" ] && [ ! -d "$GH_BIN" ]; then
      printf '%s\n' "$GH_BIN"
      return 0
    fi
    return 1
  fi
  candidate="$(command -v gh 2>/dev/null || true)"
  if [ -n "$candidate" ] && [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="${tool_root}/gh"
  if [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

verify_evidence() {
  local attempt
  local status
  for attempt in 1 2 3; do
    set +e
    node scripts/verify-remote-restore-evidence.mjs \
      --manifest "$manifest" \
      --remote-evidence "$evidence"
    status=$?
    set -e
    if [ "$status" -ne 2 ]; then
      return "$status"
    fi
    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 5))
    fi
  done
  return 2
}

find_recent_artifact() {
  local attempt
  local output
  local status
  for attempt in 1 2 3; do
    set +e
    output="$(
      node scripts/find-recent-remote-restore-artifact.mjs
    )"
    status=$?
    set -e
    if [ "$status" -ne 2 ]; then
      if [ "$status" -eq 0 ]; then
        printf '%s\n' "$output"
      fi
      return "$status"
    fi
    printf '::warning::Restore-evidence artifact lookup infrastructure failure; retrying (%s/3).\n' \
      "$attempt" >&2
    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 5))
    fi
  done
  return 2
}

download_artifact() {
  local attempt
  local name="$2"
  local run_id="$1"
  local target="$3"
  local gh_bin=""
  if ! gh_bin="$(resolve_gh_bin)"; then
    printf '::warning::GitHub CLI is unavailable on this runner; restore-evidence artifact reuse is unavailable.\n' >&2
    return 1
  fi
  for attempt in 1 2 3; do
    if "$gh_bin" run download "$run_id" \
      --repo "$GITHUB_REPOSITORY" \
      --name "$name" \
      --dir "$target"; then
      return 0
    fi
    printf '::warning::Restore-evidence artifact download infrastructure failure; retrying (%s/3).\n' \
      "$attempt" >&2
    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 5))
    fi
  done
  return 2
}

trap 'rm -rf -- "$cache"' EXIT
rm -f -- "$evidence"
mkdir -p -- "$cache" "$(dirname -- "$archive")"
artifact_status=0
artifact_tsv=""
artifact_tsv="$(find_recent_artifact)" ||
  artifact_status=$?
if [ "$artifact_status" -eq 0 ]; then
  prior_run_id=""
  prior_name=""
  IFS=$'\t' read -r prior_run_id prior_name <<< "$artifact_tsv"
  if [[ ! "$prior_run_id" =~ ^[0-9]+$ ]] ||
    [[ ! "$prior_name" =~ ^d1-remote-restore-evidence-[a-f0-9]{40}-[0-9]+$ ]]; then
    printf '::error::Restore-evidence artifact finder returned an invalid identity.\n' >&2
    exit 2
  fi
  download_status=0
  download_artifact "$prior_run_id" "$prior_name" "$cache" ||
    download_status=$?
  if [ "$download_status" -eq 2 ]; then
    printf '::error::Restore-evidence artifact download failed after retries.\n' >&2
    exit "$download_status"
  fi
  if [ "$download_status" -eq 0 ]; then
    shopt -s nullglob
    archives=("$cache"/*.tar.gz)
    if [ "${#archives[@]}" -eq 1 ] &&
      [ "$(tar -tzf "${archives[0]}")" = "d1-remote-restore-evidence.json" ] &&
      [[ "$(tar -tvzf "${archives[0]}")" = -* ]]; then
      if tar -xOzf "${archives[0]}" \
        d1-remote-restore-evidence.json > "$evidence"; then
        chmod 600 "$evidence"
        verification_status=0
        verify_evidence || verification_status=$?
        if [ "$verification_status" -eq 0 ]; then
          printf 'Recent private restore evidence is valid for this deploy.\n'
          evidence_valid=true
        elif [ "$verification_status" -eq 1 ]; then
          rm -f -- "$evidence"
        else
          exit "$verification_status"
        fi
      else
        rm -f -- "$evidence"
      fi
    fi
  fi
elif [ "$artifact_status" -ne 1 ]; then
  printf '::error::Restore-evidence artifact lookup infrastructure failed after retries.\n' >&2
  exit "$artifact_status"
fi

rm -rf -- "$cache"
if [ "$evidence_valid" != true ]; then
  printf '::error::No valid pre-generated restore evidence is available. Run the D1 remote restore evidence workflow in its recovery window, then rerun this deploy.\n' >&2
  exit 1
fi

verification_status=0
verify_evidence || verification_status=$?
if [ "$verification_status" -ne 0 ]; then
  printf '::error::Restore evidence failed re-verification before packaging.\n' >&2
  exit "$verification_status"
fi
test "$(stat -c '%a' "$evidence")" = "600"
evidence_dir="${evidence%/*}"
evidence_name="${evidence##*/}"
tar --format=posix -czf "$archive" \
  -C "$evidence_dir" \
  "$evidence_name"
chmod 600 "$archive"
test -f "$archive"
printf 'restore_evidence_archive=%s\n' "$archive"
