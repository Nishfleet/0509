#!/usr/bin/env bash
#
# Scheduled runner for the proof screenshot-rate regression guard (issue #1327).
#
# Runs on the fleet VPS under a systemd timer (0509-screenshot-rate-guard.timer)
# outside GitHub Actions, following the 0509-liveness pattern. Unlike the
# secrets-less liveness probe, this guard must read production D1, so it runs
# as the `nish` user (owns the repo checkout and the sanctioned Cloudflare
# token) and sources the sanctioned CF token file before invoking the canary.
#
# On a failed verdict (real-population screenshot rate < threshold with a
# sufficient sample) the canary exits 1 AND auto-files a GitHub issue carrying
# the rate, the sample size, and the capture-path code link (acceptance 3c),
# using the ambient `gh` auth / GITHUB_TOKEN. The non-zero exit also marks the
# systemd unit failed so journald + a watchdog always sees the regression even
# if no token is configured to file.
#
# If the sample is too small to judge (n < min-sample, or no real captures in
# the window), the canary SKIPs (exit 0) and prints why — so silence can't
# drift into a false green.

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
exec node scripts/canary-proof-screenshot-rate.mjs --file-issue