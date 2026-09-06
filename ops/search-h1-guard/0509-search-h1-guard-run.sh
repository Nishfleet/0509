#!/usr/bin/env bash
#
# Scheduled runner for the /search H1 regression guard (issue #1502,
# accept criterion #4).
#
# Runs on the fleet VPS under a systemd timer (0509-search-h1-guard.timer)
# outside GitHub Actions, following the 0509-screenshot-rate-guard pattern.
# Unlike the D1-reading guards this canary only needs outbound HTTPS to
# 0509.io (it curls the live /search surface a buyer sees), so it needs no
# Cloudflare token; it DOES need `gh` auth / GITHUB_TOKEN to auto-file when a
# regression is detected, hence it runs as the `nish` user (owner of the
# ambient gh auth).
#
# On a failed verdict (a rendered /search H1 carries a technical
# country-scope phrase) the canary exits 1 AND auto-files a GitHub issue
# carrying the offending domains and the observed H1s (accept criterion #4),
# using the ambient `gh` auth / GITHUB_TOKEN. The non-zero exit also marks
# the systemd unit failed so journald + a watchdog always sees the regression
# even if no token is configured to file.

set -euo pipefail

readonly CHECKOUT="${SEARCH_H1_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CANARY="${CHECKOUT}/scripts/canary-search-h1.mjs"

fail() {
  printf 'search-h1-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CHECKOUT}/scripts/canary-search-h1.mjs" ]] || fail "canary not found at ${CANARY}"

cd "${CHECKOUT}"
exec node scripts/canary-search-h1.mjs --file-issue
