#!/usr/bin/env bash
#
# Scheduled runner for the proof screenshot-metric guard (issue #1985).
#
# Issue #1985's metric has TWO halves on a 7-day rolling window:
#   1. >= 90% of NEW real `succeeded` proof captures carry a
#      `screenshot_artifact_key` — the "saves the screenshots" promise on the
#      population that embodies it (real watcher captures, `kind IS NULL`, NOT
#      the launch-gate rows whose keys cleanup strips by design).
#   2. zero captures are `skipped_due_to_budget` on a paid-tier watchlist
#      without a user-visible reason (`skip_reason`).
#
# Reasons this guard exists as its OWN scheduled unit rather than extending
# the screenshot-rate guard (issues #1327/#1747/#1876):
#   - the rate half is already observed by ops/screenshot-rate-guard on a 48h
#     window; #1985's metric is 7-day and must also surface the budget-skip
#     half, which NO scheduled observer covers — a silent paid-tier budget
#     skip could recur with nothing watching the reason column.
#   - this guard runs the SAME proven canaries
#     (canary-proof-screenshot-rate.mjs, canary-proof-budget-skip-surface.mjs)
#     on the issue's 168h window, so no capture-path logic is duplicated; it
#     only ADDS the missing 7-day + budget-skip observation leg.
#
# It runs on the fleet VPS under a systemd timer
# (0509-proof-metric-guard.timer) following the 0509-digest-headline-ratio
# pattern. It reads production D1, so it runs as the `nish` user and sources
# the sanctioned Cloudflare token file before invoking each canary. A failed
# verdict exits non-zero, marking the unit failed for operators and watchdogs.
#
# Exit code: the WORST of the three legs — 2 (could not run) beats 1 (a
# regression) beats 0 (pass/skip). Each canary SKIPs rather than fails when
# the window sample is too small to judge, reporting its numbers every tick
# so the empty window cannot silently mask a regression.

set -euo pipefail

readonly CHECKOUT="${PROOF_METRIC_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CF_TOKEN_FILE="${PROOF_METRIC_GUARD_TOKEN_FILE:-/home/nish/.config/cloudflare/deploy-ci.env}"
readonly RATE_CANARY="scripts/canary-proof-screenshot-rate.mjs"
readonly BUDGET_CANARY="scripts/canary-proof-budget-skip-surface.mjs"
# Issue #1985 metric window: 7 days.
readonly WINDOW_HOURS=168

fail() {
  printf 'proof-metric-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CHECKOUT}/${RATE_CANARY}" ]] || fail "screenshot-rate canary not found: ${CHECKOUT}/${RATE_CANARY}"
[[ -f "${CHECKOUT}/${BUDGET_CANARY}" ]] || fail "budget-skip canary not found: ${CHECKOUT}/${BUDGET_CANARY}"
[[ -f "${CF_TOKEN_FILE}" ]] || fail "sanctioned CF token file missing: ${CF_TOKEN_FILE}"

# Source the sanctioned Cloudflare token so `wrangler d1 execute --remote` can
# authenticate. The token value is never printed.
# shellcheck source=/dev/null
set -a
. "${CF_TOKEN_FILE}"
set +a

cd "${CHECKOUT}"

# Run one canary leg. Echoes a labelled banner so journald shows which leg
# produced which verdict. Returns the canary exit code without aborting the
# script (set +e around the invocation) so all legs always run.
run_leg() {
  local label="$1"
  shift
  printf '\n=== proof-metric-guard: %s ===\n' "${label}"
  set +e
  node "$@"
  local code=$?
  set -e
  printf '=== %s exit: %d ===\n' "${label}" "${code}"
  return "${code}"
}

# Worst-of-three: 2 (could-not-run) beats 1 (regression) beats 0 (pass/skip).
# Each `run_leg ... || code=$?` captures the canary exit code without aborting
# under `set -e`; a 0 exit leaves the code at its init value.
worst=0
run_leg "screenshot-rate watcher (168h)" "${RATE_CANARY}" --window-hours "${WINDOW_HOURS}" --file-issue || worst=$?
paid_code=0
run_leg "screenshot-rate paid-tier (168h)" "${RATE_CANARY}" --cohort paid-tier --threshold 90 --window-hours "${WINDOW_HOURS}" --file-issue || paid_code=$?
if [[ "${paid_code}" -gt "${worst}" ]]; then
  worst="${paid_code}"
fi
budget_code=0
run_leg "budget-skip surface (168h)" "${BUDGET_CANARY}" --window-hours "${WINDOW_HOURS}" || budget_code=$?
if [[ "${budget_code}" -gt "${worst}" ]]; then
  worst="${budget_code}"
fi

exit "${worst}"