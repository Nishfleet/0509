# Lane evidence — kimi/issue-2106

Issue: Nishfleet/0509#2106 — growth: enable funnel measurement with a post-enable canary.

## Preconditions verified (2026-09-09)

- Blocking packets merged: #2103 (PR #2155), #2104 (PR #2153), #2105 (PR #2165) — all MERGED.
- Nish's gates 1-2 approval on issue #2106 (2026-09-09T05:38Z): "a — approve. Retention
  period = 90 days … Gates 1-2 of spec §8 are satisfied by this comment."

## Changes

- `wrangler.jsonc`: `FUNNEL_MEASUREMENT_ENABLED` `"0"` → `"1"` (do step 1).
- `docs/ga-metrics.md`: "Collection is live since 2026-09-09" + approved 90-day retention
  recorded; gate-8 canary + rollback documented (do step 2).
- `scripts/funnel-canary-check.mjs` (new): fetches `/` with and without `Sec-GPC: 1`,
  asserts both 200; `--help` exits 0 (do step 3).
- Mechanical re-pin of guards that asserted the old off-state (forced by step 1+2):
  `tests/funnel-measurement.test.ts` committed-config guard now expects `"1"`;
  `scripts/verify-claims.mjs` funnel-flag agreement invariant now expects config on +
  docs live; `docs/customer-claim-surface-registry.json` AUDIT-FUNNEL-MEASUREMENT row
  sentence/verify updated (rows are not covered by the registry contract sha256).

## Verification

- Termination: `npm run typecheck && grep -q '"FUNNEL_MEASUREMENT_ENABLED": "1"' wrangler.jsonc && node scripts/funnel-canary-check.mjs --help` — see PR body.
- `npm run typecheck` (cf-typegen && react-router typegen && tsc -b) — see PR body.
- Targeted vitest: funnel-measurement, verify-claims, customer-claim-surface-registry,
  customer-claim-audit-table, lane-evidence-collision — see PR body.
