#!/usr/bin/env bash
#
# Scheduled runner for the Offer Timeline public-surface coverage guard
# (issue #3095 observe-to-close).
#
# Runs on the fleet VPS under a systemd timer
# (0509-timeline-coverage-guard.timer) outside GitHub Actions, following the
# 0509-demo-brand-timeline-guard pattern. Unlike that sibling this guard needs
# NO Cloudflare token: its canary (scripts/canary-timeline-coverage.mjs) is a
# zero-cost public probe of https://0509.io/sitemap.xml — the same bounded
# D1-backed render every crawler reads.
#
# Verdict mapping (the canary's documented exit contract):
#   0  pass        — coverage at/above the 80% floor above baseline: green.
#   1  pending     — baseline held (>= 7) but floor not reached: the DOCUMENTED
#                    expected state while the nightly capture pipeline
#                    populates (issue #3018 persistence, #1958 phase 2,
#                    #3194 verdict fallback). The unit SUCCEEDS on it — a
#                    pinned-red timer adds noise, not signal.
#   2  probe fail  — sitemap unfetchable/unparseable: unit FAILS.
#   3  regression  — covered < 7: indexed proof pages vanished. Unit FAILS and
#                    the canary's --file-issue path auto-files the incident
#                    (deduped against an open incident).
#
# The unit is also failed when the checkout's canary predates the
# regression/pending split (the stale-checkout assertion below): a behind
# checkout whose canary still exits 1 for regressions would silently downgrade
# every alarm to a pending observe — that must be loud, not silent.

set -euo pipefail

readonly CHECKOUT="${TIMELINE_COVERAGE_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CANARY="${CHECKOUT}/scripts/canary-timeline-coverage.mjs"

fail() {
  printf 'timeline-coverage-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CANARY}" ]] || fail "canary not found at ${CANARY}"

# Stale-checkout assertion: the guard's alarm semantics depend on the canary
# distinguishing regression (exit 3) from pending (exit 1). An older canary
# that exits 1 for both would turn every regression into a quiet observe.
grep -q '"regression"' "${CANARY}" \
  || fail "checkout canary predates the regression/pending verdict split (issue #3095) — update ${CHECKOUT}"

cd "${CHECKOUT}"

set +e
node scripts/canary-timeline-coverage.mjs --file-issue
code=$?
set -e

case "${code}" in
  0)
    printf 'timeline-coverage-guard: coverage met (canary exit 0)\n'
    exit 0
    ;;
  1)
    printf 'timeline-coverage-guard: pending — baseline held, floor not reached yet; capture pipeline populates nightly (canary exit 1)\n'
    exit 0
    ;;
  2)
    printf 'timeline-coverage-guard: probe failure — sitemap unfetchable/unparseable (canary exit 2)\n' >&2
    exit 2
    ;;
  3)
    printf 'timeline-coverage-guard: REGRESSION — covered below the seeded baseline; incident auto-filed by the canary (canary exit 3)\n' >&2
    exit 3
    ;;
  *)
    printf 'timeline-coverage-guard: unexpected canary exit %s\n' "${code}" >&2
    exit 2
    ;;
esac
