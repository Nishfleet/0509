#!/usr/bin/env bash
# BET 1 verification script (issue #1897).
#
# Asserts that the digest re-ranking produces >=60% landing_page_* headline
# items — the brief's central promise ("signal, not noise"). It runs the
# always-on headline-ratio canary (`scripts/canary-digest-headline-ratio.mjs`)
# over a deterministic fixture of delivered-digest items and checks the
# measured headline ratio against the 60% acceptance target.
#
# The fixture is the default so the check is self-contained and reproducible
# in CI / a PR without D1 or wrangler auth. Pass `--live` to sample the last
# 24h of DELIVERED digest items from production D1 instead (the same remote
# mode the scheduled guard uses).
#
# Exit codes:
#   0 — headline ratio >= 60% (prints `headline_landing_page_ratio >= 60`).
#   1 — headline ratio < 60% (verification failed).
#   2 — the canary could not produce a measurement (fixture/D1 error).
#
# The issue's termination command greps stdout for the exact string
# `headline_landing_page_ratio >= 60`, so that line is the pass receipt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT/scripts/fixtures/bet1-headline-ratio.json"

MODE="fixture"
if [[ "${1:-}" == "--live" ]]; then
  MODE="live"
elif [[ -n "${1:-}" ]]; then
  echo "verify-bet1: unknown argument '${1}' (supported: --live)" >&2
  exit 2
fi

if [[ "$MODE" == "live" ]]; then
  OUTPUT="$(node "$ROOT/scripts/canary-digest-headline-ratio.mjs" --json --no-commit 2>/dev/null)"
else
  OUTPUT="$(node "$ROOT/scripts/canary-digest-headline-ratio.mjs" --input "$FIXTURE" --json --no-commit 2>/dev/null)"
fi

# Parse the canary's JSON report and assert ratio >= target. The pass receipt
# line is printed on stdout so the issue's termination grep matches it.
node -e '
const r = JSON.parse(process.argv[1]);
if (r.ratio >= r.targetRatio) {
  console.log("headline_landing_page_ratio >= 60");
  process.exit(0);
} else {
  console.error("headline_landing_page_ratio < 60 (ratio=" + r.ratio + ", target=" + r.targetRatio + ")");
  process.exit(1);
}
' "$OUTPUT"
