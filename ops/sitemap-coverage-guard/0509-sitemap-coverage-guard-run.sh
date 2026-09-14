#!/usr/bin/env bash
#
# Scheduled runner for the advertised-URL coverage guard (issue #3166
# observe-to-close).
#
# Runs on the fleet VPS under a systemd timer
# (0509-sitemap-coverage-guard.timer), following the 0509-timeline-coverage
# guard pattern. Its canary (scripts/canary-sitemap-coverage.mjs) probes
# EVERY URL the live sitemap.xml + llms.txt advertise and must serve 200 with
# non-empty, indexable bodies — the exact divergence class that shipped three
# dead /guides/* URLs and /switch/adspy for ~3 days while the deploy chain
# was red and every source-side test stayed green.
#
# Verdict mapping (the canary's documented exit contract):
#   0  pass        — every advertised URL served 200 + non-empty + indexable.
#   1  divergence  — at least one advertised URL 404'd/redirected/empty/
#                    noindexed. Unit FAILS; the canary's --file-issue path
#                    auto-files the deduped incident.
#   2  probe fail  — sitemap/llms.txt unfetchable or unparseable. Unit FAILS.
#
# Crawl-budget posture (no token configured): the /ads + /timeline cohort
# shares a 120/10min per-IP public-brand-page budget (#2985). Token-less the
# guard paces at one request per 5.2s (~115/10min worst case — under budget
# even if every advertised URL were in the cohort), so a full pass takes
# ~16-20 min for ~180 URLs. That is why TimeoutStartSec is 1800. If the
# operator provides CANARY_BYPASS_TOKEN (see the provision script), the
# limiter exempts the public-brand-page scope for the token exactly like a
# verified crawler and the guard keeps the canary's fast default pacing.
# Without it the slow path is the SAFE path: a token-less fast run 429s its
# own brand tail (~14 self-inflicted divergences measured 2026-09-12) and
# would pin the timer red daily — noise, not signal.

set -euo pipefail

readonly CHECKOUT="${SITEMAP_COVERAGE_GUARD_CHECKOUT:-/home/nish/workspaces/products/0509}"
readonly CANARY="${CHECKOUT}/scripts/canary-sitemap-coverage.mjs"

fail() {
  printf 'sitemap-coverage-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CANARY}" ]] || fail "canary not found at ${CANARY}"

# Stale-checkout assertion: the guard's alarm semantics depend on the canary
# carrying the dedupe marker its --file-issue path files incidents with. An
# older checkout without it would file duplicate incidents per run.
grep -q 'ISSUE_BODY_MARKER' "${CANARY}" \
  || fail "checkout canary predates the sitemap-coverage incident dedupe (issue #3166) — update ${CHECKOUT}"

cd "${CHECKOUT}"

# Smoke mode (provisioning only): probe a tiny fixture set live so the smoke
# reaches a real verdict in seconds instead of a full ~17-minute crawl.
if [[ "${SITEMAP_COVERAGE_GUARD_SMOKE:-0}" == "1" ]]; then
  smoke_fixture="$(mktemp /tmp/0509-sitemap-guard-smoke.XXXXXX.xml)"
  trap 'rm -f "${smoke_fixture}"' EXIT
  cat > "${smoke_fixture}" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://0509.io/</loc></url>
  <url><loc>https://0509.io/guides</loc></url>
</urlset>
XML
  set +e
  node scripts/canary-sitemap-coverage.mjs --input "${smoke_fixture}"
  code=$?
  set -e
  case "${code}" in
    0) printf 'sitemap-coverage-guard: smoke verdict reached (canary exit 0)\n'; exit 0 ;;
    *) printf 'sitemap-coverage-guard: SMOKE FAILED — canary exit %s on a 2-URL live fixture\n' "${code}" >&2; exit 2 ;;
  esac
fi

# Token present (EnvironmentFile) → the canary's fast default pacing is safe.
# Absent → crawl-parity slow pacing under the worst-case cohort budget.
pacing_args=()
if [[ -z "${CANARY_BYPASS_TOKEN:-}" ]]; then
  pacing_args=(--concurrency 1 --delay-ms 5200)
fi

set +e
node scripts/canary-sitemap-coverage.mjs --file-issue "${pacing_args[@]}"
code=$?
set -e

case "${code}" in
  0)
    printf 'sitemap-coverage-guard: every advertised URL served 200 + indexable (canary exit 0)\n'
    exit 0
    ;;
  1)
    printf 'sitemap-coverage-guard: DIVERGENCE — advertised URL(s) not serving 200/indexable; incident auto-filed by the canary (canary exit 1)\n' >&2
    exit 1
    ;;
  2)
    printf 'sitemap-coverage-guard: probe failure — sitemap/llms.txt unfetchable or unparseable (canary exit 2)\n' >&2
    exit 2
    ;;
  *)
    printf 'sitemap-coverage-guard: unexpected canary exit %s\n' "${code}" >&2
    exit 2
    ;;
esac
