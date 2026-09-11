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

- [x] Loader-only fix applied exactly as the judge edit binds it — add `listProofCapturesByIds(env, watchlistId, ids)` to `app/lib/data/watchlist-proof.server.ts` following `listRecentProofCapturesForWatchlist`'s shape (`proof_capture` joined through `proof_target` scoped by `proof_target.watchlist_id = ?`, mapped via `toProofCaptureRecord`, `queryIn` helper like `listProofCapturePairsForEventIds`; ≤25 ids so D1 bound-param cap is fine); re-export through `app/lib/data/watchlists.server.ts` (domain barrel feeding `data.server.ts`); in `app/lib/watchlist-route-loader.server.ts` merge the union AFTER the highlighted-event pin block (~line 333-340, so a pinned deep-linked event's capture is covered): one `listProofCapturesByIds` call on the loaded events' `proofCaptureId`s, dedupe against the recent-12, append extras ordered `attemptedAt` desc (extras are older than the recent-12 window by construction); `proofSummary: buildProofSummary(...)` keeps its existing 12-recent input — semantics unchanged.

## Phase 3 — Sweep confirmation + scoped verification

- [x] Same-pattern sweep documented (manager already did it): only this loader pairs a bounded recent-capture list with a wider event set — `report-loader.server.ts` and `digest-orchestration.server.ts` already use `listProofCapturePairsForEventIds`; `monitoring.server.ts`, `first-brief.server.ts`, `digest-email.server.ts` only check `proofCaptureId` presence; api.v1/api.mcp don't touch it.
- [x] Tests GREEN via `npx vitest run --configLoader runner --project node --changed origin/main` plus `npx vitest run tests/event-changes-section.test.tsx` — typecheck is CI-owned per fleet-ops#4891 / repo AGENTS.md; never run `npm run typecheck` or coverage in a worker.
- [x] No copy constants changed; no files outside the allowed list.

Phase list: 1) RED test first + commit showing red; 2) `listProofCapturesByIds` + barrel export + loader union merge → GREEN; 3) sweep confirmation + scoped vitest runs + allowed-files guard.

## Phase 1 reviewer adjudication (verdict: PASS)

- NOTED x7: real loader exercised with exact scenario; `proofCapturesById` derivation matches `competitor-detail.tsx`; both assertions verified RED pre-fix / GREEN post-fix against the real render contract; mock discipline matches `watchlist-route-loader.test.ts`; fixtures match `~/lib/types`; `succeededAt` newer than baseline finish keeps the ordered-pair gate clear; no attribution, single allowed file.
- CONSIDER: mock binds the fix to import `listProofCapturesByIds` via the `~/lib/data.server` barrel — phase 2 must not import the leaf directly. (Carried into the phase-2 handoff.)
- CONSIDER: `listWatchEventsByIds` mocked but unused — harmless future-proofing.
- DISMISSED: `[]` recency window is the documented honest extreme; no DOM-env pragma needed (markup-only assertions).

## Phase 2 reviewer adjudication (verdict: PASS)

- All checks passed: tenant-scoped `queryIn` with `prefix` matches `listWatchEventsByIds` shape; union merges after the `?event=` pin block with dedupe; lazy `~/lib/data.server` barrel import mirrors the `listWatchEventsByIds` pattern; `proofSummary` keeps the 12-recent input; no copy constants or component code touched.
- CONSIDER (not acted): the unioned `recentProofCaptures` also feeds `classifyWatchPeriodTriage` via `app.watchlists.tsx:443` — an event-referenced older non-succeeded capture could shift triage copy in the no-confirmed-events case. Accepted: it is truthful data and the bound spec names the union as the fetched set; the confirmed-events path short-circuits to "changed" before triage classification matters.
- NOTED: `recent-evidence-checks-card` tail-fill when <4 recents — honest data, minor.
- One mechanical deviation from the handoff: `listProofCapturesByIds` is obtained via lazy `await import("~/lib/data.server")` inside the missing-ids branch (the top-level destructure would break `tests/watchlist-route-loader.test.ts`'s strict mock); `data.server.ts` needed an explicit re-export line (named barrel, not `export *`).

## Phase 3 verification

- `npx vitest run tests/event-changes-section.test.tsx --configLoader runner --project node` — 2/2 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` — 325 files / 4146 tests pass.
- Regression found + fixed in-run: `tests/watchlists.route.test.ts` strict `vi.doMock` of `~/lib/data.server` lacked the new export and its "board only until a competitor is opened" case hits the missing-ids branch — added `listProofCapturesByIds: vi.fn().mockResolvedValue([])` to the three `data.server` mock blocks (test-helper change, required by the strict mocks).
- Typecheck deferred to CI per fleet-ops#4891 / repo AGENTS.md (never run in a worker).
