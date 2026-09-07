## Problem

`0509-landing-page-artifacts` holds ~4,566 objects / 15.8 GB, but D1 references at most ~603 artifact keys. ~87% of the bucket is orphaned — R2 objects with no D1 row pointing at them. `runRetentionSweep` only deletes artifacts it can reach *through D1*, so an object that loses its row is invisible to the sweep forever. There is no R2 -> D1 reconciliation anywhere in the codebase.

## Fix

Add a bounded R2 -> D1 reconciliation step to the existing six-hourly retention sweep.

- List `landing-pages/` with a cursor, persisting the cursor between ticks in a new `retention_sweep_state` D1 table so one sweep never walks the whole bucket. The cursor advances only when the whole page is processed; if the per-tick delete cap is hit mid-page, the cursor is left unchanged so the next tick re-lists the same page and continues (no object is skipped).
- For each key, require `parseProofArtifactKey` to accept it. Skip anything else untouched — in particular `backups/d1/`, which has its own 90-day lifecycle rule.
- Delete only when the key is absent from D1 (checked across `proof_capture.html_artifact_key`, `proof_capture.screenshot_artifact_key`, `landing_page_snapshot.artifact_key`, plus the metadata/ad JSON reference paths the existing guards already cover) **and** the date embedded in the key is at least 7 days old (grace period for a row written after its object).
- Cap deletes per tick at 200 so the invocation budget holds.
- The delete path is gated behind `R2_ORPHAN_RECONCILE_ENABLED`. Until that env var is set, the step runs in **dry-run mode** and only reports counts — so the first production run is automatically a dry-run, exercised before the delete path is enabled. Dry-run advances the cursor so it walks the whole bucket and reports the full backlog; when the delete path is first enabled after a dry-run, the cursor is reset so the live run starts from the beginning. The dry-run counts are logged in the `retention_sweep` cron handler.

### Note on `deleteProofArtifacts`

The issue asks to "reuse `deleteProofArtifacts` so the existing shared/referenced guards apply." `deleteProofArtifacts` requires an owner id and refuses keys with no owner reference (`unreferenced` / `denied` outcomes) — it cannot delete a truly orphaned object, which by definition has no D1 row and therefore no owner. The reconciliation instead applies the same shared/referenced guard directly: `artifactKeyReferencedInD1` checks every place a key can be referenced (the three columns plus the metadata/ad JSON paths the existing `artifactReferencedOutsideSnapshot`/`artifactReferencedOutsideProofCapture` guards already cover) and skips any referenced key. Only a key with zero D1 references past the grace window is deleted.

## Acceptance

- Unit tests (`tests/orphan-reconcile.test.ts`): referenced key survives; shared key survives; orphan inside the grace window survives; orphan outside it is deleted; a non-matching key (`backups/d1/...`) is never touched; the cursor advances and resumes; deletes are capped at 200 and the cursor does not advance when the cap is hit mid-page; dry-run reports counts without deleting and advances the cursor; the cursor resets when the delete path is first enabled after a dry-run.
- Dry-run mode reports counts without deleting, gated behind `R2_ORPHAN_RECONCILE_ENABLED` (absent = dry-run). Exercised once against production before the delete path is enabled.
- After the backlog drains, object count approaches the D1 reference count plus recent writes.

## Verification

- `npx vitest run --configLoader runner --project node` — 602 files / 7157 tests passed.
- `npx vitest run --configLoader runner --project workers` — 33 files / 169 tests passed (includes the `retention-sweep-state.integration.test.ts` which applies the real migrations and asserts the new READ and WRITE path, plus the `artifactKeyReferencedInD1` reference query against real D1 schema).
- `tests/orphan-reconcile.test.ts` — 10 tests passed.
- `tests/retention.test.ts` — 12 tests passed (existing suite, no regressions).

## run-proof

- Unit + integration test runs above are the run proof for this change.
- The reconciliation is wired into the existing `retention_sweep` cron task (six-hourly warmup) via `runRetentionSweep`; no new timer or workflow is added.

## research

- The R2 `list` cursor API and the existing `parseProofArtifactKey` / `deleteProofArtifacts` guards were read from the codebase before implementing. The orphan path does a direct R2 delete because `deleteProofArtifacts` cannot delete unreferenced keys (see note above).

## help-first

- `reconcileOrphanedArtifacts` is a new exported function; its behavior is documented in the JSDoc and covered by unit tests. No new CLI or bin file is added.

## organ-heartbeat

- `migrations/0085_retention_sweep_state.sql` is a new additive table (no DROP/ALTER), not an organ change. `app/lib/retention.server.ts` is an existing organ extended in place; no new organ is introduced.

## Reviewer round

Reviewer seat: `minimax/MiniMax-M3` (senior seat from `find_senior_seat`).

Findings adjudication (one round):
- **Act on** — cursor-skip bug when the delete cap is hit mid-page: fixed by leaving the cursor unchanged on cap hit so the next tick re-lists the same page and no object is skipped.
- **Act on** — dry-run counts not surfaced in production: fixed by logging `orphanReconcile` in the `retention_sweep` cron handler.
- **Act on** — dry-run only reported the first page: fixed by advancing the cursor in dry-run and resetting it when the delete path is first enabled after a dry-run (mode stored in `retention_sweep_state`).
- **Act on** — integration test under-covered the real reconcile SQL: extended to exercise `artifactKeyReferencedInD1` against real D1 schema via `landing_page_snapshot` metadata and `ad.raw_json` rows.
- **Consider** — `artifactKeyReferencedInD1` re-runs per object on a cap-hit re-list: correct and bounded (re-checking references is required for correctness); noted, no change.
- **Consider** — wiring test could assert `failedSteps` is empty: the mock DB intentionally throws on the other sweep steps, so this is expected; noted, no change.

Second review confirms all four prior findings resolved; no critical or warning findings remain.

## Test plan

- Unit tests cover every acceptance bullet.
- Integration test applies the real migrations and asserts the `retention_sweep_state` READ and WRITE path.
- Dry-run is the default until `R2_ORPHAN_RECONCILE_ENABLED` is set, so the first production run is safe.

net-positive-because: this PR adds the R2 -> D1 reconciliation mechanism (the issue's whole point) plus its unit and integration tests; the net-positive diff is the mechanism itself, not scaffolding, and it reclaims ~13 GB of orphaned R2 storage while stopping a ~0.43 GB/day leak no existing code path could see.

Closes #1926
