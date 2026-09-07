#!/usr/bin/env bash
#
# Scheduled runner for the proof screenshot-rate regression guard
# (issues #1327, #1747, #1876).
#
# Runs on the fleet VPS under a systemd timer (0509-screenshot-rate-guard.timer)
# outside GitHub Actions, following the 0509-liveness pattern. Unlike the
# secrets-less liveness probe, this guard must read production D1, so it runs
# as the `nish` user (owns the repo checkout and the sanctioned Cloudflare
# token) and sources the sanctioned CF token file before invoking the canary.
#
# Two cohorts run every tick, each on a rolling 48h window:
#   1. watcher  — all real watcher captures (kind IS NULL), alert < 80%
#                 (issue #1327/#1747: the regression guard of last resort).
#   2. paid-tier — paid-plan watcher captures (plan_at_capture IN
#                 scout/starter/agency), alert < 90% — the homepage "saves the
#                 screenshots" promise on the cohort it is paid to honour
#                 (issue #1876 acceptance 4: a canary that asserts the 48h
#                 screenshot rate >= 90% on a paid-tier watchlist cohort).
#
# On a failed verdict (rate < threshold with a sufficient sample) a cohort's
# canary exits 1 AND auto-files a GitHub issue carrying the rate, the sample
# size, and the capture-path code link, using the ambient `gh` auth /
# GITHUB_TOKEN. The non-zero exit also marks the systemd unit failed so
# journald + a watchdog always sees the regression even if no token is
# configured to file.
#
# If the sample is too small to judge (n < min-sample, or no real captures in
# the window), a cohort SKIPs (exit 0) and prints why — so silence can't
# drift into a false green. The paid-tier cohort SKIPs until plan_at_capture
# is populated by a deploy and paid-tier captures flow; the SKIP is reported
# every run so the empty window cannot silently mask a regression.
#
# Exit code: the WORST of the two cohorts — exit 2 if either canary could not
# run, exit 1 if either verdict failed, else exit 0.

set -euo pipefail

readonly CHECKOUT="${SCREENSHOT_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CF_TOKEN_FILE="${SCREENSHOT_GUARD_TOKEN_FILE:-/home/nish/.config/cloudflare/deploy-ci.env}"
readonly CANARY="${CHECKOUT}/scripts/canary-proof-screenshot-rate.mjs"

fail() {
  printf 'screenshot-rate-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CHECKOUT}/scripts/canary-proof-screenshot-rate.mjs" ]] || fail "canary not found at ${CANARY}"
[[ -f "${CF_TOKEN_FILE}" ]] || fail "sanctioned CF token file missing: ${CF_TOKEN_FILE}"

# Source the sanctioned Cloudflare token so `wrangler d1 execute --remote` can
# authenticate. The token value is never printed.
# shellcheck source=/dev/null
set -a
. "${CF_TOKEN_FILE}"
set +a

cd "${CHECKOUT}"

# Run one cohort. Echoes a labelled banner so journald shows which cohort
# produced which verdict. Returns the canary exit code without aborting the
# script (set +e around the invocation) so both cohorts always run.
run_cohort() {
  local label="$1"
  shift
  printf '\n=== screenshot-rate-guard: %s cohort ===\n' "${label}"
  set +e
  node scripts/canary-proof-screenshot-rate.mjs "$@"
  local code=$?
  set -e
  printf '=== %s cohort exit: %d ===\n' "${label}" "${code}"
  return "${code}"
}

# Worst-of-two: 2 (could-not-run) beats 1 (regression) beats 0 (pass/skip).
# Each `run_cohort ... || code=$?` captures the canary exit code without
# aborting under `set -e`; a 0 exit leaves the code at its init value.
worst=0
run_cohort "watcher" --file-issue || worst=$?
paid_code=0
run_cohort "paid-tier" --cohort paid-tier --threshold 90 --file-issue || paid_code=$?
if [[ "${paid_code}" -gt "${worst}" ]]; then
  worst="${paid_code}"
fi

exit "${worst}"
