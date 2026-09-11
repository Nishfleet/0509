fix: truthful reference counting and error reporting in proof-artifact retention (M33, M34, M35)

## What changed
Three defect fixes in `app/lib/proof-artifact-retention.server.ts`, each with a RED→GREEN test in `tests/proof-artifact-retention.test.ts` (new file, 15 tests):

- **M33** — `getProofArtifactInventory` counted `landing_page_snapshot` references only through `ad_observation → watchlist_run → watchlist` INNER JOINs, so an observation-less snapshot (a real state: the `deleteExpiredLandingPageSnapshots` sweeper's own `NOT EXISTS` clause proves it) contributed 0 rows and the `shared_reference` guard could delete an R2 object a snapshot still points at. The snapshot branch now counts straight from `landing_page_snapshot` (`artifact_key = ?` OR metadata `$.htmlArtifactKey` / `$.screenshotArtifactKey`, guarded by `json_valid`), with the owner chain converted to LEFT JOINs so a NULL owner still counts as a reference but never as an owner match — exactly how the three sibling guards treat metadata-held keys.
- **M34** — `compensateUncommittedProofArtifacts` early-returned `{ok:false, deleted:0, failed:1}` on the first malformed key, stranding every valid artifact as an unreferenced R2 object. It now does per-value accounting (`if (!parsed) { failed += 1; continue; }`) and deletes the valid keys, returning `{ok: failed === 0, deleted, failed}`. The missing-bucket path counts malformed + valid keys as failed.
- **M35** — `deleteProofArtifactsForCapture` wrapped the R2 `head`/`delete` and the D1 reference clear in one `try`, so a D1 throw after a successful R2 delete was misreported as `r2:"failed", d1:"not_updated"`. It now mirrors `deleteOneProofArtifact`: inner try around each `clearCaptureProofArtifactReference` call reporting the truthful already-computed `r2` with `d1:"failed"`, reserving `r2:"failed"` for R2 failures.

## RED→GREEN (per finding, all in tests/proof-artifact-retention.test.ts)
- M33: snapshot with `artifact_key = HTML_KEY` and no `ad_observation` + owner `proof_capture` → `landingPageSnapshotReferences` was 0 (RED), now 1; `deleteProofArtifacts` outcome was deletion, now `shared_reference`.
- M34: `{artifactKey: HTML_KEY, metadata: {htmlArtifactKey: "not-a-key"}}` → R2 delete was never called (RED, early return), now `HTML_KEY` deleted and `failed === 1`.
- M35: R2 delete succeeds, D1 clear throws → was `r2:"failed", d1:"not_updated"` (RED), now `r2:"deleted", d1:"failed"`.

## Same-pattern sweep (step 3)
Swept `proof-artifact-retention.server.ts` and its callers: `deleteOneProofArtifact` already has the correct nested-try structure (used as the model); `deleteProofArtifacts`, `headProofArtifactForOwner`, `getProofArtifactForOwner` contain no combined R2+D1 try and no early-return-on-malformed-key loop; no further instances. Sweep findings are recorded in `.fleet/plan.md`.

## Verification
Post-rebase runs on this branch (rebased onto origin/main @ 03b8c6375):
- `npx vitest run --configLoader runner --project node tests/proof-artifact-retention.test.ts` → **15/15 passed**.
- `npx vitest run --configLoader runner --project node --changed origin/main` → **327 files / 4193 tests passed**.
- Typecheck is CI-owned (memory-capped unit; not run locally).

`run-proof: tests/proof-artifact-retention.test.ts 15/15 green; node --changed origin/main 327 files / 4193 tests green`

## Scope checks
- `research:` — no `bin/` files added; `research-before-build-check` not applicable.
- `help-first:` — not applicable.
- rebuild/masking diffs: none.
- organ diffs: none (`organ-heartbeat:` not-an-organ — reference-counting SQL in a retention lib, not an organ file).
- No migrations touched; no public behaviour changed beyond the three named findings.

## Senior reviewer round (seat: cursor/cursor-grok-4.6-high)
One round, diff `origin/main...HEAD` against the issue acceptance and the repo tests. Review-adjudication buckets:
- **Act on:** none.
- **Consider:** NULL-owner snapshots count in `landingPageSnapshotReferences` but not `ownerMatchCount`, so `referenceState` for an ownerless snapshot is `"shared_reference"` rather than owner-denied — matches the sibling-guard semantics and the issue's fix paragraph; accepted.
- **Noted:** `compensateUncommittedProofArtifacts`'s non-string slot values are dropped by a pre-existing filter (predates this change); malformed values count per-occurrence while valid keys dedupe via Set (spec-per-value semantics); M35's outer catch still exists for head/delete failures (`r2_failed` reserved, correct).
- **Dismissed-with-reason:** none.

Phase reviewer verdicts from the phase loop: phase 1 SHIP, phase 2 SHIP, phase 3/4 sweep confirmed no further instances (`.fleet/plan.md`).

loose-ends: none known — the production caller at retention.server.ts pre-guards with a join-free query, so behaviour there is unchanged; the fix repairs the exported contract for other callers.

Closes #2463
