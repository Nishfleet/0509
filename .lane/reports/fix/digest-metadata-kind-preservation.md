# Lane 15 — digest metadata.kind preservation (item 4aa9208e5d)

## Item
Digest materiality: preserve `metadata.kind` through `digestMetadataForEvent` so first-scan baselines classify cosmetically.

## Root cause
First-scan baseline events ride the `ad_new` event type because the `watch_event` CHECK constraint pins the type list; `metadata.kind: "baseline"` is the marker that reclassifies them as starting snapshots (`classifyDigestPeriodEvent`, app/lib/change-intelligence.ts). `digestMetadataForEvent` builds the metadata persisted onto digest items (app/lib/digest-orchestration.server.ts:502) but only copies whitelisted keys, so `kind` was dropped. Later materiality reads over the stored items — `digestMaterialityReason({ items })` in the digest email (app/lib/digest-email.server.ts:174) and the briefs route (app/routes/app.digests.tsx:239) — re-classified baselines as campaign movement ("ads started or stopped") instead of cosmetic.

## Fix
- app/lib/change-intelligence.ts: `digestMetadataForEvent` now preserves `kind` (when a non-empty string) in its output, with a comment explaining the CHECK-constraint/baseline relationship.
- tests/digest-email.test.ts: regression test — a baseline event's persisted metadata keeps `kind: "baseline"` and `digestMaterialityReason` over it still returns the cosmetic-only copy, never "ads started or stopped".

## Verification
- `npx vitest run tests/digest-email.test.ts`: 71 passed (includes new test).
- Red-check: stashing the source change makes the new test fail (1 failed | 70 skipped), confirming it guards the regression.
- Wider surface: digest-email, digest-intelligence, digest-triage-orchestration, digest-strategy.server, digest-brief-green-mark, digest-route-presentation, monitoring — 158 tests passed across 7 files.
- `npm run typecheck`: clean.

## PR
https://github.com/Nishfleet/0509/pull/860 (branch `fix/digest-metadata-kind-preservation`, commit 223c6b25, based on origin/main c24e9735)
