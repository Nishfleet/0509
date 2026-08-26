#!/usr/bin/env bash
# Verify pre-generated exact R2 restore evidence and package it for upload.
#
# Called directly as a `run:` step from deploy-production.yml.
#
# Archive path is owned by RESTORE_EVIDENCE_ARCHIVE (job-level env). The
# upload-artifact step must reference ${{ env.RESTORE_EVIDENCE_ARCHIVE }} —
# never a duplicated path literal.
set -euo pipefail
umask 077

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${RESTORE_EVIDENCE_ARCHIVE:?RESTORE_EVIDENCE_ARCHIVE is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_JOB:?GITHUB_JOB is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

MAX_ARTIFACT_SIZE_BYTES=10485760
MAX_EVIDENCE_JSON_BYTES=1048576
MAX_UNCOMPRESSED_TAR_BYTES=$((MAX_EVIDENCE_JSON_BYTES + 65536))

evidence="$RUNNER_TEMP/d1-remote-restore-evidence.json"
manifest="$RUNNER_TEMP/d1-remote-restore-candidate-manifest.json"
cache=""
archive_staging_dir=""
evidence_valid=false
archive="$RESTORE_EVIDENCE_ARCHIVE"
expected_archive="$RUNNER_TEMP/d1-remote-restore-evidence-${GITHUB_SHA}-${GITHUB_RUN_ID}.tar.gz"

report_evidence_available() {
  # Machine-readable contract for the deploy workflow: whether this run
  # produced a verified evidence archive. Written to GITHUB_OUTPUT when GitHub
  # provides it (hermetic shell-level tests omit it) and echoed for the log.
  printf 'restore_evidence_available=%s\n' "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'restore_evidence_available=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

if [ "$archive" != "$expected_archive" ] ||
  [ -e "$archive" ] ||
  [ -L "$archive" ]; then
  # A stale or planted file at the private archive path is never read; the
  # deploy workflow generates a fresh exact evidence archive instead. Only
  # tooling infrastructure failures (exit 2 below) remain hard stops.
  printf '::error::Refusing an unexpected or pre-existing restore-evidence archive path; generating fresh evidence in this deploy.\n' >&2
  report_evidence_available false
  exit 0
fi

cleanup() {
  [ -z "$cache" ] || rm -rf -- "$cache"
  [ -z "$archive_staging_dir" ] || rm -rf -- "$archive_staging_dir"
}
trap cleanup EXIT

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
  local artifact_id="$1"
  local archive_member
  local archive_member_size
  local api_status
  local curl_status
  local download
  local download_config
  local download_size
  local extracted
  local headers
  local location
  local max_artifact_size="$2"
  local expected_member="$3"
  local target="$4"
  local zip_listing
  if ! command -v curl >/dev/null 2>&1 ||
    ! command -v unzip >/dev/null 2>&1; then
    printf '::error::curl and unzip are required to retrieve restore evidence on this runner.\n' >&2
    return 2
  fi
  download="$target/actions-artifact.zip"
  download_config="$target/artifact-download.conf"
  headers="$target/github-api.headers"
  for attempt in 1 2 3; do
    rm -f -- "$download" "$download_config" "$headers"
    set +e
    api_status="$({
      printf 'header = "Authorization: Bearer %s"\n' "$GH_TOKEN"
      printf 'header = "Accept: application/vnd.github+json"\n'
      printf 'header = "X-GitHub-Api-Version: 2026-03-10"\n'
    } | curl --disable --config - \
        --proto '=https' \
        --proto-redir '=https' \
        --silent \
        --show-error \
        --dump-header "$headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip")"
    curl_status=$?
    set -e
    if [ "$curl_status" -eq 0 ] && [ "$api_status" = "302" ]; then
      location="$(
        awk '
          tolower($1) ~ /^http\// {
            status = $2
            sub(/\r$/, "", status)
            location = ""
            next
          }
          tolower($1) == "location:" {
            sub(/^[^:]+:[[:space:]]*/, "")
            sub(/\r$/, "")
            location = $0
          }
          END {
            if (status == "302" && location != "") print location
          }
        ' "$headers"
      )"
      if [[ "$location" =~ ^https://[^[:space:]\"\\]+$ ]]; then
        printf 'url = "%s"\n' "$location" > "$download_config"
        chmod 600 "$download_config"
      else
        location=""
      fi
    elif [ "$curl_status" -eq 0 ] && [ "$api_status" = "410" ]; then
      printf '::warning::Restore-evidence artifact expired before download.\n' >&2
      return 1
    elif [ "$curl_status" -eq 0 ] &&
      [[ ! "$api_status" =~ ^5[0-9][0-9]$ ]]; then
      printf '::error::Restore-evidence artifact API returned unexpected HTTP status %s.\n' \
        "$api_status" >&2
      return 2
    else
      location=""
    fi
    if [ -n "$location" ] &&
      curl --disable --config "$download_config" \
        --proto '=https' \
        --proto-redir '=https' \
        --fail \
        --location \
        --max-filesize "$max_artifact_size" \
        --silent \
        --show-error \
        --output "$download"; then
      download_size="$(stat -c '%s' -- "$download")"
      if [[ ! "$download_size" =~ ^[0-9]+$ ]] ||
        [ "$download_size" -lt 1 ] ||
        [ "$download_size" -gt "$max_artifact_size" ]; then
        printf '::error::Restore-evidence artifact zip exceeds its size bound.\n' >&2
        rm -f -- "$download" "$download_config" "$headers"
        return 1
      fi
      archive_member="$(unzip -Z1 "$download")" || {
        printf '::error::Restore-evidence artifact zip could not be inspected.\n' >&2
        rm -f -- "$download" "$download_config" "$headers"
        return 1
      }
      if [ "$archive_member" != "$expected_member" ]; then
        printf '::error::Restore-evidence artifact zip has an unexpected member.\n' >&2
        rm -f -- "$download" "$download_config" "$headers"
        return 1
      fi
      zip_listing="$(unzip -Z -l "$download")" || {
        printf '::error::Restore-evidence artifact zip could not be sized.\n' >&2
        rm -f -- "$download" "$download_config" "$headers"
        return 1
      }
      archive_member_size="$(
        awk -v member="$archive_member" '
          $NF == member && $4 ~ /^[0-9]+$/ { print $4 }
        ' <<< "$zip_listing"
      )"
      if [[ ! "$archive_member_size" =~ ^[0-9]+$ ]] ||
        [ "$archive_member_size" -lt 1 ] ||
        [ "$archive_member_size" -gt "$max_artifact_size" ]; then
        printf '::error::Restore-evidence artifact member exceeds its size bound.\n' >&2
        rm -f -- "$download" "$download_config" "$headers"
        return 1
      fi
      extracted="$target/$archive_member"
      if unzip -p "$download" "$archive_member" |
        head -c "$((max_artifact_size + 1))" > "$extracted" &&
        [ "$(stat -c '%s' -- "$extracted")" -le "$max_artifact_size" ]; then
        chmod 600 "$extracted"
        rm -f -- "$download" "$download_config" "$headers"
        return 0
      fi
      rm -f -- "$extracted"
    fi
    printf '::warning::Restore-evidence artifact download infrastructure failure; retrying (%s/3).\n' \
      "$attempt" >&2
    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 5))
    fi
  done
  rm -f -- "$download" "$download_config" "$headers"
  return 2
}

rm -f -- "$evidence"
cache="$(
  mktemp -d \
    "$RUNNER_TEMP/d1-remote-restore-download-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_JOB}-XXXXXXXXXXXX"
)"
chmod 700 "$cache"
test ! -L "$cache"
test "$(stat -c '%u:%a:%F' -- "$cache")" = "$(id -u):700:directory"
artifact_status=0
artifact_tsv=""
artifact_tsv="$(find_recent_artifact)" ||
  artifact_status=$?
if [ "$artifact_status" -eq 0 ]; then
  prior_artifact_id=""
  prior_artifact_size=""
  prior_run_id=""
  prior_name=""
  IFS=$'\t' read -r prior_run_id prior_artifact_id prior_artifact_size prior_name <<< "$artifact_tsv"
  if [[ ! "$prior_run_id" =~ ^[0-9]+$ ]] ||
    [[ ! "$prior_artifact_id" =~ ^[0-9]+$ ]] ||
    [[ ! "$prior_artifact_size" =~ ^[0-9]+$ ]] ||
    [ "$prior_artifact_size" -lt 1 ] ||
    [ "$prior_artifact_size" -gt "$MAX_ARTIFACT_SIZE_BYTES" ] ||
    [[ ! "$prior_name" =~ ^d1-remote-restore-evidence-[a-f0-9]{40}-[0-9]+$ ]]; then
    printf '::error::Restore-evidence artifact finder returned an invalid identity.\n' >&2
    exit 2
  fi
  download_status=0
  download_artifact \
    "$prior_artifact_id" \
    "$MAX_ARTIFACT_SIZE_BYTES" \
    "$prior_name.tar.gz" \
    "$cache" ||
    download_status=$?
  if [ "$download_status" -eq 2 ]; then
    printf '::error::Restore-evidence artifact download failed after retries.\n' >&2
    exit "$download_status"
  fi
  if [ "$download_status" -eq 0 ]; then
    shopt -s nullglob
    archives=("$cache"/*.tar.gz)
    bounded_tar="$cache/d1-remote-restore-evidence.tar"
    evidence_member_size=""
    bounded_tar_ready=false
    if [ "${#archives[@]}" -eq 1 ] &&
      gzip -dc "${archives[0]}" |
        head -c "$((MAX_UNCOMPRESSED_TAR_BYTES + 1))" > "$bounded_tar" &&
      [ "$(stat -c '%s' -- "$bounded_tar")" -le "$MAX_UNCOMPRESSED_TAR_BYTES" ]; then
      chmod 600 "$bounded_tar"
      bounded_tar_ready=true
      evidence_member_size="$(
        tar -tvf "$bounded_tar" |
          awk '
            $NF == "d1-remote-restore-evidence.json" &&
              $3 ~ /^[0-9]+$/ {
              print $3
            }
          '
      )"
    fi
    if [ "$bounded_tar_ready" = true ] &&
      [ "$(tar -tf "$bounded_tar")" = "d1-remote-restore-evidence.json" ] &&
      [[ "$(tar -tvf "$bounded_tar")" = -* ]] &&
      [[ "$evidence_member_size" =~ ^[0-9]+$ ]] &&
      [ "$evidence_member_size" -le "$MAX_EVIDENCE_JSON_BYTES" ]; then
      if tar -xOf "$bounded_tar" \
        d1-remote-restore-evidence.json |
        head -c "$((MAX_EVIDENCE_JSON_BYTES + 1))" > "$evidence" &&
        [ "$(stat -c '%s' -- "$evidence")" -le "$MAX_EVIDENCE_JSON_BYTES" ]; then
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
  # No usable pre-generated evidence exists (none found, or the newest
  # artifact does not verify against this exact candidate). This is not an
  # infrastructure failure: the deploy workflow generates fresh exact-SHA
  # evidence in this same run, and the exact verifier still gates the deploy.
  # Only the exit-2 infrastructure failures above remain hard stops.
  printf '::warning::No valid pre-generated restore evidence is available; this deploy will generate fresh exact evidence before release.\n' >&2
  report_evidence_available false
  exit 0
fi

# Package the verified evidence. Any packaging failure (re-verification,
# staging, or publish) falls back to fresh generation instead of hard-failing
# the deploy: the evidence is discarded and the workflow's generate job
# produces a new exact archive on a fresh runner.
package_verified_evidence() {
  local verification_status=0
  local evidence_dir
  local evidence_name
  local staged_archive
  verify_evidence || verification_status=$?
  if [ "$verification_status" -ne 0 ]; then
    printf '::warning::Restore evidence failed re-verification before packaging; this deploy will generate fresh exact evidence.\n' >&2
    return 1
  fi
  test "$(stat -c '%a' "$evidence")" = "600" || return 1
  evidence_dir="${evidence%/*}"
  evidence_name="${evidence##*/}"
  archive_staging_dir="$(
    mktemp -d \
      "$RUNNER_TEMP/d1-remote-restore-package-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_JOB}-XXXXXXXXXXXX"
  )" || return 1
  chmod 700 "$archive_staging_dir" || return 1
  test ! -L "$archive_staging_dir" || return 1
  test "$(stat -c '%u:%a:%F' -- "$archive_staging_dir")" = "$(id -u):700:directory" || return 1
  staged_archive="$archive_staging_dir/restore-evidence.tar.gz"
  tar --format=posix -czf "$staged_archive" \
    -C "$evidence_dir" \
    "$evidence_name" || return 1
  chmod 600 "$staged_archive" || return 1
  test ! -L "$staged_archive" || return 1
  test -f "$staged_archive" || return 1
  test "$(stat -c '%u:%a:%h:%F' -- "$staged_archive")" = "$(id -u):600:1:regular file" || return 1
  test "$(tar -tzf "$staged_archive")" = "d1-remote-restore-evidence.json" || return 1
  [[ "$(tar -tvzf "$staged_archive")" = -* ]] || return 1
  test ! -e "$archive" || return 1
  test ! -L "$archive" || return 1
  mv -T -- "$staged_archive" "$archive" || return 1
  test ! -L "$archive" || return 1
  test -f "$archive" || return 1
  test "$(stat -c '%u:%a:%h:%F' -- "$archive")" = "$(id -u):600:1:regular file" || return 1
  return 0
}

if ! package_verified_evidence; then
  printf '::warning::Verified restore evidence could not be packaged; this deploy will generate fresh exact evidence.\n' >&2
  report_evidence_available false
  exit 0
fi
report_evidence_available true
printf 'restore_evidence_archive=%s\n' "$archive"
