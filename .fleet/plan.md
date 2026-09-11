# .fleet/plan.md — Nishfleet/0509#2463 (proof-artifact retention: M33, M34, M35)

Scope: `app/lib/proof-artifact-retention.server.ts` + `tests/proof-artifact-retention.test.ts` only.
TDD per finding: RED test first, smallest durable fix, GREEN, then same-pattern sweep.
Termination gate: `npx vitest run --configLoader runner --project node tests/proof-artifact-retention.test.ts` green. Do NOT run `npm run typecheck` or coverage locally — CI owns those (memory-capped unit).

## Phase 1 — M33: count orphaned landing_page_snapshot references

- [x] phase 1: RED — new test seeds (via the D1 mock emulating per-branch WHERE semantics, or a bind-aware fake) one `landing_page_snapshot` row with `artifact_key = HTML_KEY` and no `ad_observation`, plus an owner `proof_capture` with `html_artifact_key = HTML_KEY`; assert `getProofArtifactInventory(env, HTML_KEY, OWNER)` returns `landingPageSnapshotReferences === 1` (fails today: 0)
- [x] phase 1: RED — same fixture: `deleteProofArtifacts(env, OWNER, [HTML_KEY])` returns outcome `shared_reference` and R2 `delete`/`head` never called (fails today: R2 object is deleted)
- [x] phase 1: fix `getProofArtifactInventory` (~lines 108-118): snapshot branch selects straight from `landing_page_snapshot` with `WHERE artifact_key = ? OR (json_valid(metadata_json) AND json_extract(metadata_json,'$.htmlArtifactKey') = ?) OR (json_valid(metadata_json) AND json_extract(metadata_json,'$.screenshotArtifactKey') = ?)`; owner_id via LEFT JOIN `ad_observation` → `watchlist_run` → `watchlist`; NULL owner stays NULL (ignored by `COUNT(DISTINCT)`, never matches `owner_match_count`); bind order updated to (owner, 3 snapshot binds, 1 proof_capture bind)
- [x] phase 1: GREEN — run the scoped vitest command; new M33 tests pass, no regressions (12/12)

## Phase 2 — M34: compensateUncommittedProofArtifacts must not strand valid keys

- [x] phase 2: RED — test `compensateUncommittedProofArtifacts(env, {artifactKey: HTML_KEY, metadata: {htmlArtifactKey: "not-a-key"}})` → valid key still passed to R2 `delete`, result `failed === 1` (fails today: early-returns `{ok:false, deleted:0, failed:1}`, delete never called)
- [x] phase 2: fix (~lines 423-428): replace early-return with per-value accounting — hoist `failed` counter, `if (!parsed) { failed += 1; continue; }`, collect valid keys into the Set, then run the existing delete loop; return `{ok: failed === 0, deleted, failed}` (adjust the `keys.size === 0` and missing-bucket paths to include malformed counts)
- [x] phase 2: GREEN — run the scoped vitest command; new M34 test passes, existing compensate test still green (14/14)

## Phase 3 — M35: deleteProofArtifactsForCapture reports truthful r2/d1 split

- [x] phase 3: RED — test where R2 `head`+`delete` succeed but the D1 clear UPDATE throws (mock `run()` rejecting after successful R2 ops) → `result.r2 === "deleted"`, `result.d1 === "failed"`, outcome `d1_failed` (fails today: `r2:"failed", d1:"not_updated"`)
- [x] phase 3: fix (~lines 319-337): mirror `deleteOneProofArtifact` — inner try around only the `clearCaptureProofArtifactReference` call, reporting the already-computed `r2` with `d1:"failed"`/`outcome:"d1_failed"`; outer catch reserved for `r2_missing`/head/delete failures (`r2:"failed", d1:"not_updated"`)
- [x] phase 3: GREEN — run the scoped vitest command; new M35 test passes, no regressions

## Phase 4 — same-pattern sweep + termination

- [x] phase 4: sweep `proof-artifact-retention.server.ts` and `app/lib/` siblings/callers for the three patterns — early-return-on-first-malformed-key loops, one-try wrapping R2+D1 pairs, INNER-JOIN-only reference counting — and fix every instance found (none expected beyond the three fixes, but verify `deleteProofArtifacts`, `headProofArtifactForOwner`, `getProofArtifactForOwner` paths)
- [x] phase 4: termination — `npx vitest run --configLoader runner --project node tests/proof-artifact-retention.test.ts` fully green; record pass count; confirm no typecheck/coverage was run locally

Phase 3/4 completed: `deleteProofArtifactsForCapture` now mirrors `deleteOneProofArtifact` with an inner try around each `clearCaptureProofArtifactReference` call (including the `artifactReferencedOutsideCapture` branch) so a D1 failure reports `d1_failed` with the truthful `r2` outcome. The same-pattern sweep confirmed `deleteOneProofArtifact` is already structured this way, `deleteProofArtifacts`/`headProofArtifactForOwner`/`getProofArtifactForOwner` contain no R2+D1 combined try, and `compensateUncommittedProofArtifacts` uses per-value accounting. The scoped test file passed 15/15.
- phase 2 reviewer verdict: SHIP. Consider/Noted (recorded): non-string slot values are silently dropped by the pre-existing filter (defensible, predates change); malformed values count per-occurrence while valid keys dedupe via Set (spec-per-value semantics); delete-loop resilience and empty-snapshot early exit unpinned by tests (adjacent, not required).
