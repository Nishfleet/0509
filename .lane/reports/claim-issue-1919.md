# Lane evidence — claim/issue-1919 (Nishfleet/0509#1919)

## Root cause (named)

The nightly capture is not writing rows. Production `browser_job_telemetry`
shows the `cloudflare_browser_run` leg recording `outcome='failed'` for
nike.com, nykaa.com and mamaearth.com on every nightly run since the backfill
shipped (2026-09-05 → 2026-09-07, 3/3 nights each), while allbirds.com and
lenskart.com succeed on the same leg. `landing_page_snapshot` holds only the
artifact-less `backfill-*` seed rows for the three failing brands, so the
proof gate (issue #1284) correctly filters them and `/timeline/<brand>`
honestly returns 410. The gate is not the defect.

Measured rendered DOM sizes of the real pages:

- nike.com     ≈ 1,105,438 B rendered HTML (> 1 MiB cap)
- nykaa.com    ≈ 1,584,871 B rendered HTML (> 1 MiB cap)
- mamaearth.com≈ 1,881,855 B rendered HTML (> 1 MiB cap)
- allbirds.com ≈   639,478 B (under the cap — succeeds)
- lenskart.com   passes in prod via cloudflare_browser_run

All three failing brands sit above `MAX_RENDERED_HTML_BYTES` (1 MiB); both
passing brands are under it. The oversized DOM hits the `html_oversized`
reject in `captureBrowserRunSnapshot` → `recordRun("failed")` → the demo
backfill's `requireScreenshot` contract records `screenshot_required` and
writes no row. Nykaa additionally edge-blocks non-stealth clients
(HTTP 403 / `ERR_HTTP2_PROTOCOL_ERROR` to curl and stock headless Chromium;
a real anti-detect browser session renders it fine), so a second provider
leg is now allowlisted for the five demo origins.

## Change

- `app/lib/browser-run.server.ts`: `MAX_RENDERED_HTML_BYTES` 1,000,000 →
  3,000,000 (same order as the 3 MiB screenshot cap; still fails closed
  above the bound).
- `wrangler.jsonc`: `BROWSERLESS_PROOF_ALLOWLIST_ORIGINS` set to the two
  existing 0509.io defaults plus the five `www.<demo-brand>` origins, so the
  existing Browserless BQL fallback leg (`captureBrowserlessProofSnapshot`)
  actually runs when the Browser Run session fails for a demo brand. The
  token/binding is already configured in production.
- Parity docs/constants for the dormant netcup renderer
  (`ops/netcup-browser`, `docs/ops/netcup-browser-renderer.md`) updated to
  the 3 MiB landing-HTML bound.

No proof-gate change: rows still require both a stored screenshot artifact
and a page-text artifact to reach the public ledger.

## Regression guard

- `tests/integration/demo-brand-backfill.integration.test.ts` — new test
  asserts every demo brand has ≥1 proof-bearing `landing_page_snapshot` row
  (`snapshotRowHasCompleteProof`) after a backfill run: fails when a brand
  has zero, i.e. the next occurrence is caught before deploy.
- `tests/landing-pages.browser-run.test.ts` — a >1 MiB real-shape rendered
  page now produces a full proof bundle; >3 MiB still fails closed.

## Evidence

- `npx vitest run tests/landing-pages.browser-run.test.ts` → 52/52 pass.
- `npx vitest run --project workers tests/integration/demo-brand-backfill.integration.test.ts` → 6/6 pass.
- `npm test` → node project 599 files / 7143 tests, workers project 32 files / 163 tests: all pass.
- `npm run typecheck` → clean (cf-typegen regenerated env types include the new var).
- `node --test ops/netcup-browser/tests/server.test.mjs` → 12/12 pass.
- verify-0509 local E2E (`npm run e2e:serve:local`, port 4179):
  `/timeline/nike.com` → 200 with dated ledger + "As of" affordance;
  `/timeline/nykaa.com` → 410 on the artifact-less seed row only — the same
  honest gate behavior production shows.
- `systemctl --user reset-failed 0509-demo-brand-timeline-canary.service` →
  ok; a manual unit run still reports FAILED against production pre-deploy
  (expected: no proof rows exist for the three brands until the nightly
  04:00 UTC cron runs the fixed code).

## Production verification plan

The canary can only go green after merge → CI deploy → next `0 4 * * *` run
writes proof-bearing `demo-*` rows. A `wrangler tail` capture is armed for
that window (`0509-backfill-tail-1919`) to record the per-brand
`backfill completed` summary.
