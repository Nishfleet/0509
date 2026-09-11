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

# .fleet/plan.md — Nishfleet/0509#2477 (watchlist loader: union proof captures for verified diff plate)

Bug: the watchlist route loader pulls 24 events (`listWatchEvents(env, id, 24)`) but only 12
recent proof captures (`listRecentProofCapturesForWatchlist(env, id, 12)`). A confirmed event
whose `proofCaptureId` points at a capture outside the 12-cap resolves
`proofCapturesById.get(...) → null`, so `resolveEventChangeQuietCopy` returns
`EVENT_CHANGE_UNVERIFIED_COPY` ("no successful stored capture behind it") — false; the capture
exists in D1.

Binding judge edits — loader-only fix. Allowed files:
`app/lib/watchlist-route-loader.server.ts`, `app/lib/data/watchlist-proof.server.ts`,
`app/lib/data/watchlists.server.ts` (barrel line), `tests/event-changes-section.test.tsx`
(new file, binding name). No copy constants, no component code.

## Phase 1 — RED test only (commit, show red)

- [x] Failing test written first per the repro, RED shown — new `tests/event-changes-section.test.tsx` mocks `~/lib/data.server` (pattern: `tests/watchlist-route-loader.test.ts`): `listWatchEvents` → [confirmed event `proofCaptureId: "cap-old"`, `baselineFromRunId: "run-0"`, metadata `{from,to}`], `listWatchlistRuns` → [baseline run-0], `listRecentProofCapturesForWatchlist` → [] or 12 other captures (NOT cap-old), `listProofCapturesByIds` → `vi.fn()` resolving [succeeded cap-old record]; run the real loader, build `proofCapturesById` from `payload.recentProofCaptures` the way `competitor-detail.tsx:409` does, render `EventChangesSection` via the `tests/event-change-green-mark.test.tsx` `renderFeed()` harness (createElement + createRoutesStub + renderToStaticMarkup, fixtures shaped like `tests/watchlist-change-feed.test.tsx`), assert markup does NOT contain "no successful stored capture" (or equivalently derived inputs yield `canRenderEventDiffPlate === true`); RED pre-fix because the loader never calls `listProofCapturesByIds` → cap-old absent → unverified copy.

## Phase 2 — Loader-only fix (GREEN)

- [ ] Loader-only fix applied exactly as the judge edit binds it — add `listProofCapturesByIds(env, watchlistId, ids)` to `app/lib/data/watchlist-proof.server.ts` following `listRecentProofCapturesForWatchlist`'s shape (`proof_capture` joined through `proof_target` scoped by `proof_target.watchlist_id = ?`, mapped via `toProofCaptureRecord`, `queryIn` helper like `listProofCapturePairsForEventIds`; ≤25 ids so D1 bound-param cap is fine); re-export through `app/lib/data/watchlists.server.ts` (domain barrel feeding `data.server.ts`); in `app/lib/watchlist-route-loader.server.ts` merge the union AFTER the highlighted-event pin block (~line 333-340, so a pinned deep-linked event's capture is covered): one `listProofCapturesByIds` call on the loaded events' `proofCaptureId`s, dedupe against the recent-12, append extras ordered `attemptedAt` desc (extras are older than the recent-12 window by construction); `proofSummary: buildProofSummary(...)` keeps its existing 12-recent input — semantics unchanged.

## Phase 3 — Sweep confirmation + scoped verification

- [ ] Same-pattern sweep documented (manager already did it): only this loader pairs a bounded recent-capture list with a wider event set — `report-loader.server.ts` and `digest-orchestration.server.ts` already use `listProofCapturePairsForEventIds`; `monitoring.server.ts`, `first-brief.server.ts`, `digest-email.server.ts` only check `proofCaptureId` presence; api.v1/api.mcp don't touch it.
- [ ] Tests GREEN via `npx vitest run --configLoader runner --project node --changed origin/main` plus `npx vitest run tests/event-changes-section.test.tsx` — typecheck is CI-owned per fleet-ops#4891 / repo AGENTS.md; never run `npm run typecheck` or coverage in a worker.
- [ ] No copy constants changed; no files outside the allowed list.

Phase list: 1) RED test first + commit showing red; 2) `listProofCapturesByIds` + barrel export + loader union merge → GREEN; 3) sweep confirmation + scoped vitest runs + allowed-files guard.

## Phase 1 reviewer adjudication (verdict: PASS)

- NOTED x7: real loader exercised with exact scenario; `proofCapturesById` derivation matches `competitor-detail.tsx`; both assertions verified RED pre-fix / GREEN post-fix against the real render contract; mock discipline matches `watchlist-route-loader.test.ts`; fixtures match `~/lib/types`; `succeededAt` newer than baseline finish keeps the ordered-pair gate clear; no attribution, single allowed file.
- CONSIDER: mock binds the fix to import `listProofCapturesByIds` via the `~/lib/data.server` barrel — phase 2 must not import the leaf directly. (Carried into the phase-2 handoff.)
- CONSIDER: `listWatchEventsByIds` mocked but unused — harmless future-proofing.
- DISMISSED: `[]` recency window is the documented honest extreme; no DOM-env pragma needed (markup-only assertions).
