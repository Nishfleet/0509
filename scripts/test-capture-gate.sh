#!/usr/bin/env bash
# Capture-validity gate — termination test (BET 4, issue #1900).
#
# The issue's termination criterion is verbatim: "`scripts/test-capture-gate.sh`
# exits 0." This script is that gate. It runs the adversarial fixture suite and
# asserts the whole-suite invariant the issue demands:
#
#   - every non-change fixture (500 error, Cloudflare challenge, cookie wall,
#     partially-loaded SPA, site-down-then-restored, timestamp-only edit,
#     rotating banner) produces ZERO events — each is recorded as
#     `capture_failed` or `suppressed` with a machine-readable reason, never
#     an alert;
#   - a genuine price edit in the same suite still produces exactly ONE event.
#
# The per-fixture cases live in the vitest files this script runs. A passing
# run of those files is the closure evidence the issue asks for; this script
# is the single, runnable, exit-code proof of that closure.
#
# Usage:
#   scripts/test-capture-gate.sh
#
# Exit 0 when every fixture suite passes; non-zero otherwise. The script is
# deliberately thin: it delegates the actual assertions to the existing vitest
# suites (the same ones `npm run test` runs) so the gate cannot drift from the
# tests that define the behavior.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The adversarial fixture suite lives in these node-project files plus the
# workerd/D1 integration file. Each is a vitest file; the node files run in
# the `node` project, the integration file in the `workers` project.
NODE_FIXTURE_FILES=(
  "tests/capture-validity.test.ts"
  "tests/capture-validity-pipeline.test.ts"
  "tests/capture-validity-termination.test.ts"
  "tests/capture-validity-corroboration.test.ts"
  "tests/capture-validity-public-rules.test.ts"
  "tests/capture-rules-page.test.ts"
)
INTEGRATION_FIXTURE_FILE="tests/integration/capture-validity/capture-validity.integration.test.ts"

fail() {
  printf 'test-capture-gate: FAIL: %s\n' "$1" >&2
  exit 1
}

# --- node project: the adversarial fixture suite ---------------------------
printf 'test-capture-gate: running node fixture suite (%s files)\n' "${#NODE_FIXTURE_FILES[@]}"
if ! npx vitest run --configLoader runner --project node "${NODE_FIXTURE_FILES[@]}"; then
  fail "node fixture suite failed (adversarial fixtures must produce zero events for non-changes and one for a genuine price edit)"
fi

# --- workers project: real D1 integration ----------------------------------
printf 'test-capture-gate: running workerd/D1 integration fixture\n'
if ! npx vitest run --configLoader runner --project workers "$INTEGRATION_FIXTURE_FILE"; then
  fail "workerd/D1 integration fixture failed (capture_failed/suppressed rows must never become landing_page_* events)"
fi

printf 'test-capture-gate: PASS — zero events for non-changes, one event for a genuine price edit\n'
exit 0
