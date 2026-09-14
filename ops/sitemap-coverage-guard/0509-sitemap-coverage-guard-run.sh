#!/usr/bin/env bash
#
# Scheduled runner for the advertised-URL coverage guard (issue #3166
# observe-to-close).
#
# Runs on the fleet VPS under a systemd timer
# (0509-sitemap-coverage-guard.timer), following the 0509-digest-headline-
# ratio guard's ops rail: a guard-owned checkout synced to origin/main on
# every fire, no GitHub Actions runner in the loop. Its canary
# (scripts/canary-sitemap-coverage.mjs) probes EVERY URL the live
# sitemap.xml + llms.txt advertise and must serve 200 with non-empty,
# indexable bodies — the exact divergence class that shipped three dead
# /guides/* URLs and /switch/adspy for ~3 days while the deploy chain was
# red and every source-side test stayed green.
#
# Verdict mapping (the canary's documented exit contract):
#   0  pass        — every advertised URL served 200 + non-empty + indexable.
#   1  divergence  — at least one advertised URL 404'd/redirected/empty/
#                    noindexed. Unit FAILS; the canary's --file-issue path
#                    auto-files the deduped incident.
#   2  probe fail  — sitemap/llms.txt unfetchable or unparseable, or the
#                    guard's own plumbing broke. Unit FAILS.
#
# Crawl-budget posture (no token configured): the /ads + /timeline cohort
# shares a 60/60s per-IP public-brand-page edge budget (#2985, raised from
# 12/60s by #3156). Token-less the guard paces at one request per 5.2s
# (~11.5/min — under budget even if every advertised URL were cohort), so a
# full pass over the ~360-URL advertised set takes ~31-35 min. That is why
# TimeoutStartSec is 3600. If the operator provides CANARY_BYPASS_TOKEN
# (see the provision script), the limiter exempts the public-brand-page
# scope for the token exactly like a verified crawler and the guard keeps
# the canary's fast default pacing. Without it the slow path is the SAFE
# path: a token-less fast run 429s its own brand tail (~14 self-inflicted
# divergences measured 2026-09-12) and would pin the timer red daily —
# noise, not signal.

set -euo pipefail

readonly STATE_DIR="${SITEMAP_COVERAGE_STATE_DIR:-${HOME}/.local/state/0509-sitemap-coverage}"
readonly REPO_URL="https://github.com/Nishfleet/0509.git"
readonly MIRROR="/home/nish/workspaces/.mirrors/0509.git"

fail() {
  printf 'sitemap-coverage-guard: %s\n' "$*" >&2
  exit 2
}

# Fail loud if node/gh are not resolvable on the service PATH. systemd does
# not source the nish user's login shell, so the unit must carry an explicit
# Environment=PATH (set by the provision script). If that is missing or
# wrong, print the resolved PATH to the journal so the failure is
# diagnosable instead of a bare 'node: command not found'.
if ! command -v node >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then
  fail "node/gh not on PATH; resolved PATH=${PATH}"
fi

mkdir -p "${STATE_DIR}"

# --- Resolve the checkout ---------------------------------------------------
# An explicit SITEMAP_COVERAGE_GUARD_CHECKOUT override is used as-is
# (testing / staging): the guard NEVER fetches or resets a caller-owned
# tree — a `reset --hard` there could destroy someone else's work.
if [[ -n "${SITEMAP_COVERAGE_GUARD_CHECKOUT:-}" ]]; then
  CHECKOUT="${SITEMAP_COVERAGE_GUARD_CHECKOUT}"
else
  CHECKOUT="${STATE_DIR}/checkout"
  if [[ ! -d "${CHECKOUT}/.git" ]]; then
    if [[ -d "${MIRROR}" ]]; then
      git clone --reference-if-able "${MIRROR}" "${REPO_URL}" "${CHECKOUT}" \
        || fail "could not clone ${REPO_URL}"
    else
      git clone "${REPO_URL}" "${CHECKOUT}" || fail "could not clone ${REPO_URL}"
    fi
  fi
  # This checkout is guard-owned, so hard-syncing to origin/main is safe.
  git -C "${CHECKOUT}" fetch origin main || fail "git fetch origin main failed"
  git -C "${CHECKOUT}" reset --hard -q origin/main \
    || fail "could not reset guard checkout to origin/main"
fi
readonly CHECKOUT

# Fail cheap before anything heavier: if the canary is not on the synced ref
# yet (the PR has not merged), a timer fire costs only a fetch, not a crawl.
CANARY="${CHECKOUT}/scripts/canary-sitemap-coverage.mjs"
[[ -f "${CANARY}" ]] \
  || fail "canary not found at ${CANARY} (has the PR landed on main?)"

# Stale-checkout assertion: the guard's alarm semantics depend on the canary
# carrying the dedupe marker its --file-issue path files incidents with. An
# older checkout without it would file duplicate incidents per run.
grep -q 'ISSUE_BODY_MARKER' "${CANARY}" \
  || fail "checkout canary predates the sitemap-coverage incident dedupe (issue #3166) — update ${CHECKOUT}"

cd "${CHECKOUT}"

# Smoke mode (provisioning only): probe a tiny fixture set live so the smoke
# reaches a real verdict in seconds instead of a full ~31-minute crawl.
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
