#!/usr/bin/env bash
set -euo pipefail

# Prune dead self-hosted GitHub Actions runner registrations for the 0509 repo.
#
# The blue-green hardened-runner proof registered instances named
# "0509-hardened-<instance>" but never enabled them (services stay disabled
# and stopped per provision-hardened-runners.sh). Once the real fleet
# (netcup-rs2000-verify1/2/3) is online, those "0509-hardened-*"
# registrations are dead leftovers: they stay offline forever and inflate the
# registered-runner count, confusing capacity accounting.
#
# This script lists repository runner registrations, finds offline entries
# whose name matches the stale "0509-hardened-*" prefix, and reports them.
# With --apply it deletes them. Online runners and any other names (including
# the real "netcup-rs2000-*" fleet) are never touched.
#
# Usage:
#   GITHUB_TOKEN=... ops/github-runners/prune-dead-registrations.sh        # dry run
#   GITHUB_TOKEN=... ops/github-runners/prune-dead-registrations.sh --apply  # delete
#
# Auth: GITHUB_TOKEN/GH_TOKEN env var, or an authenticated `gh` CLI.

readonly REPOSITORY="${REPOSITORY:-Nishfleet/0509}"
readonly STALE_NAME_PREFIX="${STALE_NAME_PREFIX:-0509-hardened-}"
readonly TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
readonly APPLY="${1:-}"

die() {
  printf 'runner registration prune error: %s\n' "$*" >&2
  exit 1
}

api() {
  local method="$1" path="$2"
  if [[ -n "${TOKEN}" ]]; then
    curl --fail --silent --show-error --request "${method}" \
      --header "Authorization: Bearer ${TOKEN}" \
      --header "Accept: application/vnd.github+json" \
      "https://api.github.com/${path}"
  elif command -v gh >/dev/null 2>&1; then
    gh api --method "${method}" "${path}"
  else
    die "set GITHUB_TOKEN/GH_TOKEN or authenticate the gh CLI"
  fi
}

list_registrations() {
  local page runners total_count
  page=1
  while :; do
    runners="$(api GET "repos/${REPOSITORY}/actions/runners?per_page=100&page=${page}")"
    printf '%s' "${runners}" | jq -c '.runners[]'
    total_count="$(printf '%s' "${runners}" | jq -r '.total_count')"
    if ((page * 100 >= total_count)); then
      break
    fi
    page=$((page + 1))
  done
}

main() {
  [[ "${APPLY}" == "" || "${APPLY}" == "--apply" ]] ||
    die "unknown argument: ${APPLY} (expected --apply to delete, nothing for a dry run)"

  local stale_count=0
  local id name status
  while IFS= read -r runner; do
    [[ -n "${runner}" ]] || continue
    name="$(printf '%s' "${runner}" | jq -r '.name')"
    status="$(printf '%s' "${runner}" | jq -r '.status')"
    [[ "${name}" == "${STALE_NAME_PREFIX}"* ]] || continue
    [[ "${status}" == "offline" ]] || {
      printf 'skipping %s (%s): not offline\n' "${name}" "${status}" >&2
      continue
    }
    id="$(printf '%s' "${runner}" | jq -r '.id')"
    printf 'found stale registration: %s (id %s, status %s)\n' "${name}" "${id}" "${status}"
    if [[ "${APPLY}" == "--apply" ]]; then
      api DELETE "repos/${REPOSITORY}/actions/runners/${id}" >/dev/null
      printf 'deleted stale registration: %s (id %s)\n' "${name}" "${id}"
    fi
    stale_count=$((stale_count + 1))
  done < <(list_registrations)

  if [[ "${stale_count}" -eq 0 ]]; then
    printf 'no stale "%s*" registrations found; fleet is clean\n' "${STALE_NAME_PREFIX}"
  elif [[ "${APPLY}" != "--apply" ]]; then
    printf 'dry run: %s stale registration(s) found; re-run with --apply to delete\n' "${stale_count}"
  else
    printf 'pruned %s stale registration(s)\n' "${stale_count}"
  fi
}

main "$@"
