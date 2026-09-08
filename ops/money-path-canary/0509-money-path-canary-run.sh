#!/usr/bin/env bash
#
# Money-path availability canary (issue #2001), 5-minute systemd timer on the
# fleet VPS, following the 0509-search-h1-guard pattern (a system unit
# running as the nish user, like the h1 guard).
#
# Each run:
#   1. runs the search-latency probe in --money-path-only mode (the /search
#      selected-result money-path URL plus a bounded rotating slice of the
#      /ads/:domain cohort — never the 25-domain latency set, so a 5-minute
#      cadence stays inside the /ads rate budget), appending
#      $STATE_DIR/money-path.csv;
#   2. runs the search-latency regression guard with --money-path-csv, which
#      auto-files a GitHub issue when any money-path URL returned non-200
#      twice within 10 minutes (two consecutive samples), using the ambient
#      `gh` auth — hence it runs as the `nish` user.
#
# Needs no Cloudflare token: outbound HTTPS to 0509.io plus `gh` only.

set -euo pipefail

readonly CHECKOUT="${MONEY_PATH_CANARY_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly STATE_DIR="${MONEY_PATH_STATE_DIR:-${HOME}/workspaces/agent-state/money-path-canary}"
readonly PROBE="${CHECKOUT}/scripts/search-latency-probe.mjs"
readonly GUARD="${CHECKOUT}/scripts/search-latency-regression-guard.mjs"

fail() {
  printf 'money-path-canary: %s\n' "$*" >&2
  exit 2
}

[[ -f "${PROBE}" ]] || fail "probe script missing: ${PROBE}"
[[ -f "${GUARD}" ]] || fail "guard script missing: ${GUARD}"

mkdir -p "${STATE_DIR}"

# The rotating /ads slice advances one window per run: derive the window from
# minutes-since-epoch / 5 so no state file is needed and the whole cohort
# cycles deterministically.
ads_window=$(( $(date -u +%s) / 60 / 5 ))

cd "${CHECKOUT}"
node "${PROBE}" --money-path-only --ads-window "${ads_window}" --output-dir "${STATE_DIR}"

# The state file makes filing idempotent: an already-filed flap is not
# re-filed on the next run, while a red run whose filing run was missed
# still files (see filterUnfiledIncidents in the guard).
exec node "${GUARD}" --money-path-csv "${STATE_DIR}/money-path.csv" \
  --money-path-state-file "${STATE_DIR}/money-path-guard-state.json"
