#!/usr/bin/env bash
#
# Scheduled runner for the demo-brand Offer Timeline regression guard (issue
# #1449, accept criterion #5).
#
# Runs on the fleet VPS under a systemd timer
# (0509-demo-brand-timeline-guard.timer) outside GitHub Actions, following the
# 0509-screenshot-rate-guard pattern. The guard must read production D1, so it
# runs as the `nish` user (owns the repo checkout and the sanctioned
# Cloudflare token) and sources the sanctioned CF token file before invoking
# the canary.
#
# On a failed verdict (a watched demo brand's landing_page_snapshot corpus
# dropped to 0 rows) the canary exits 1 AND auto-files a GitHub issue carrying
# the per-brand counts and the write-path code link (accept criterion #5),
# using the ambient `gh` auth / GITHUB_TOKEN. The non-zero exit also marks the
# systemd unit failed so journald + a watchdog always sees the regression even
# if no token is configured to file.

set -euo pipefail

readonly CHECKOUT="${DEMO_BRAND_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CF_TOKEN_FILE="${DEMO_BRAND_GUARD_TOKEN_FILE:-/home/nish/.config/cloudflare/deploy-ci.env}"
readonly CANARY="${CHECKOUT}/scripts/canary-demo-brand-timeline.mjs"

fail() {
  printf 'demo-brand-timeline-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CHECKOUT}/scripts/canary-demo-brand-timeline.mjs" ]] || fail "canary not found at ${CANARY}"
[[ -f "${CF_TOKEN_FILE}" ]] || fail "sanctioned CF token file missing: ${CF_TOKEN_FILE}"

# Source the sanctioned Cloudflare token so `wrangler d1 execute --remote` can
# authenticate. The token value is never printed.
# shellcheck source=/dev/null
set -a
. "${CF_TOKEN_FILE}"
set +a

cd "${CHECKOUT}"
exec node scripts/canary-demo-brand-timeline.mjs --file-issue