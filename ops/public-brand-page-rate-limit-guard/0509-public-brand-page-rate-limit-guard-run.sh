#!/usr/bin/env bash
#
# Scheduled runner for the /ads rate-limit error-body regression guard
# (issue #1930, accept criterion #4).
#
# Runs on the fleet VPS under a systemd timer
# (0509-public-brand-page-rate-limit-guard.timer) outside GitHub Actions,
# following the 0509-search-h1-guard pattern. Unlike the D1-reading guards
# this canary only needs outbound HTTPS to 0509.io (it curls the live /ads
# surface a buyer sees), so it needs no Cloudflare token; it DOES need `gh`
# auth / GITHUB_TOKEN to auto-file when a regression is detected, hence it
# runs as the `nish` user (owner of the ambient gh auth).
#
# On a failed verdict (a tripped 429 rendered the generic error shell or
# dropped Retry-After) the canary exits 1 AND auto-files a GitHub issue
# carrying the observed status, body, and flags (accept criterion #4), using
# the ambient `gh` auth / GITHUB_TOKEN. The non-zero exit also marks the
# systemd unit failed so journald + a watchdog always sees the regression
# even if no token is configured to file.

set -euo pipefail

readonly CHECKOUT="${PUBLIC_BRAND_PAGE_RATE_LIMIT_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CANARY="${CHECKOUT}/scripts/canary-public-brand-page-rate-limit.mjs"

fail() {
  printf 'public-brand-page-rate-limit-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CHECKOUT}/scripts/canary-public-brand-page-rate-limit.mjs" ]] || fail "canary not found at ${CANARY}"

cd "${CHECKOUT}"
exec node scripts/canary-public-brand-page-rate-limit.mjs --file-issue
