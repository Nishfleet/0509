# Lane report — claim/issue-3473

Issue: Nishfleet/0509#3473 — succeeded `proof_capture` rows must carry
screenshot evidence; aggregate 48h screenshot rate ≥90% at n≥20.

## Metric before (prod, read-only)

The issue's own verification query against remote D1 `0509`:

```sql
SELECT SUM(screenshot_artifact_key IS NOT NULL) s, COUNT(*) n
FROM proof_capture
WHERE status='succeeded' AND created_at >= datetime('now','-48 hours')
```

Result: **s=22, n=59 → 37%** — below the 90% bar, so not observe-to-close.

## Dominant sink

37/59 succeeded rows had no `screenshot_artifact_key`, no `html_artifact_key`,
and no `skip_reason`. All 37 belong to watchlist
`launch-readiness-canary-watchlist` (target `https://0509.io/`),
`capture_metadata_json.kind = 'launch_readiness_real_capture'`. The captures
genuinely rendered and stored artifacts; `cleanupLaunchReadinessCanary` then
deleted the R2 objects and nulled the D1 keys while preserving the succeeded
audit row — leaving status=succeeded with no evidence attached.

The real-watcher population (kind IS NULL) is 20/20 with screenshots — the
aggregate deficit is entirely the stripped canary class, already documented as
structural in `scripts/canary-proof-screenshot-rate.mjs`.

## Fix

Every canary capture since the #3105 deploy archives a second,
desktop-viewport artifact pair whose keys live only in
`capture_metadata_json` (`desktopHtmlArtifactKey` /
`desktopScreenshotArtifactKey`). Those R2 objects already survive cleanup —
the orphan sweep protects metadata-referenced keys
(`retention.server.ts → artifactKeyReferencedInD1`). Prod check: 31/43 recent
canary rows carry the pair; every row written since 2026-09-12T13:50Z has it.

`cleanupCanaryProofArtifacts` now:

- parses the surviving pair from `capture_metadata_json`, accepting only keys
  that satisfy `isKnownProofArtifactKey` (producer-owned `landing-pages/`
  keys);
- excludes them from the deletion set (the mobile pair is still deleted);
- promotes them onto the preserved `proof_capture` row via COALESCE
  (`html_artifact_key` / `screenshot_artifact_key`) — idempotent on re-runs;
- leaves legacy rows without desktop metadata on the old strip path;
- still fails the cleanup claim when artifact deletion / reference
  reconciliation does not converge.

`CLEANUP_TRUTH` on the canary route updated to match.

## Why keep rather than re-mark/delete

The preserved rows are load-bearing: `getLaunchReadinessSignals` counts them
toward `recentSuccessfulCaptures` (its kind exclusion filters a different
kind value), and the cleanup-guard tests codify the preserve-the-row
contract. Re-marking them skipped would starve the gate; deleting them is the
same. The screenshots were genuinely captured, so attaching the surviving
reference is the honest fix. The 90-day `deleteExpiredProofCaptureArtifacts`
sweep still bounds artifact lifetime; no extra Browserless spend.

## Regression coverage

`tests/launch-cleanup-guard.test.ts` →
"keeps the surviving screenshot reference on the preserved proof capture":
mobile pair deleted, desktop pair promoted onto the row, second cleanup
idempotent. Verified red against the pre-fix module
(`git show origin/main:app/lib/data/launch-canary-cleanup.server.ts` → the
test fails), green after.

## Test evidence

- `npx vitest run --configLoader runner --project node tests/launch-cleanup-guard.test.ts` → 15/15 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 4592/4597 pass; the 5 failures are 10s timeouts in unrelated files (pricing.route, worker-origin-assertion, discovery-customer-payload) on a load-avg-51 box — all 22 pass in isolation with `--testTimeout 60000`. None touch launch-canary cleanup.

## Out of scope / notes

- No migration, no schema change, no workflow edits, no Browserless spend.
- Historical rows already stripped stay stripped (no prod D1 mutation in this
  lane). Rows written pre-deploy inside the 48h window age out; the metric
  converges to the real-watcher rate (~100%) within 48h of deploy. The
  cleanup path also self-heals a stripped row that still carries desktop keys
  in metadata if its gateRunId is re-cleaned.
- `e2e:serve:local` not applicable — the harness declares no R2 binding and
  the canary route is launch-gate authenticated; the vitest D1/R2 harness is
  the correct proof level for this path.
- `scripts/canary-proof-screenshot-*.mjs` unchanged — their
  `launch_canary_stripped` classification still correctly labels the legacy
  stripped population; the docblocks describe the pre-#3473 contract.
