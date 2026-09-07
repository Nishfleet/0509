## Root cause

The nightly capture is not writing proof-bearing rows for nike.com, nykaa.com, and mamaearth.com. The proof gate is doing its job: those three brands still have only the artifact-less `backfill-*` seeds, so `/timeline/<brand>` honestly returns 410.

#1921 already raised `MAX_RENDERED_HTML_BYTES` to 3 MiB and allowlisted the five `www.<demo-brand>` origins for the existing Browserless fallback. That code is on main (merge `3f466251`) and live after the later successful Deploy production run. It has not had a capture pass since 04:00 UTC, which is the only rail that called `runDemoBrandBackfill`.

Production D1 (read-only, 2026-09-07T15:16Z): allbirds.com and lenskart.com have `demo-*` `browser_render` rows with artifacts for 2026-09-05..07; nike/nykaa/mamaearth have only `backfill-*-20260825` seeds (`has_artifact=0`). `browser_job_telemetry` for `proof_capture` at 04:00 UTC is 3 failed + 2 succeeded cloudflare_browser_run legs each night, with **zero** `browserless_bql` rows — the fallback never ran because the allowlist was not live at 04:00.

Second cause: `https://www.mamaearth.com/` 301s to `https://mamaearth.com/` (apex). The #1921 allowlist named only www origins, so a Browserless retry after that hop could be skipped even once the fallback is live.

## Fix

- Hourly proof-hole catch-up on the existing `13 * * * *` gap-check rail: `runDemoBrandProofHoleCatchUp` runs a capture pass only while a demo brand still has zero public-timeline entries. After every brand has a proof-bearing row, later ticks are a D1 read and do not spend Browser Run minutes. No new cron (soak still covers only the four workload schedules).
- Browserless allowlist treats www and apex as the same origin, and wrangler vars now list both forms for the five demo brands.

The public proof gate is unchanged. Unproven rows still 410. Catch-up calls `runDemoBrandBackfill` only for the brands that still 410, so a hole does not recapture allbirds/lenskart.

## Reviewer round (product, one round)

Seat: senior (arm-check usable). Diff reviewed against the issue acceptance (five public 200s, named write-path cause, proof gate unchanged).

Act on: catch-up was going to recapture every demo brand missing *today's* row whenever any brand 410'd — extra Browser Run spend on brands that already serve 200. Fixed: catch-up passes only `missingDomains`.

Consider: none left in this round.

Noted: the public `--http` canary stays FAILED until this PR deploys and the next `13 * * * *` tick writes proof rows. That is a time gate, not a widened proof gate.

Dismissed: letting unproven seed rows through the public ledger — worse than a 410, and the issue forbids it.

## Verification

Targeted tests (worktree at `78f325e9`):

```
npx vitest run --configLoader runner --project node tests/worker-scheduled-handler.test.ts tests/landing-pages.browser-run.test.ts
  Test Files  2 passed (2)
  Tests  67 passed (67)

npx vitest run --configLoader runner --project workers tests/integration/demo-brand-backfill.integration.test.ts
  Test Files  1 passed (1)
  Tests  8 passed (8)

npx tsc -b --pretty false
  exit 0

sgscan --base origin/main
  No new security findings.
```

Production canary replay after this change (still red until the first hourly catch-up after deploy — expected):

```
demo-brand-timeline canary (mode=http, origin=https://0509.io at 2026-09-07T15:30:06.289Z)
- nike.com: HTTP 410
- nykaa.com: HTTP 410
- allbirds.com: HTTP 200
- lenskart.com: HTTP 200
- mamaearth.com: HTTP 410
verdict: FAILED
```

The `node scripts/canary-demo-brand-timeline.mjs --http` call failed with verdict FAILED (exit 1). That is the live 410 this PR is meant to close after deploy plus the next `13 * * * *` tick.

A `npx wrangler dev --remote --test-scheduled` invoke of the catch-up against prod bindings failed with wrangler bundling errors (`Could not resolve "~/lib/..."` / `virtual:react-router/server-build`). Catch-up therefore waits for this PR's Deploy production, then the next hourly gap-check.

A one-off `wrangler d1 execute` probe for `browser_job_telemetry.metadata_json` failed with SQLITE_ERROR `no such column: metadata_json`; the table has no reason column. Failure reasons above come from duration/outcome/provider rows plus live curl redirects, not from that missing column.

run-proof: vitest node 67/67 + workers integration 8/8 + `tsc -b` exit 0 + `sgscan --base origin/main` clean

net-positive-because: the hourly catch-up and www/apex matcher are the smallest change that closes a live public 410 without waiting until 04:00 UTC or adding a cron.

organ-heartbeat: workers/app.ts not-an-organ: 0509 product scheduled handler, not a fleet-ops organ

loose-ends: production-http-canary-awaits-first-hourly-catch-up-after-deploy

Closes #1919
