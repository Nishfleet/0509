## Summary

The watchlist detail loader pulls the 24 newest events but only the 12 newest proof captures. A confirmed `website_page_changed`/`landing_page_offer_changed` event whose `proofCaptureId` aged out of the 12-cap resolved to `null` in `proofCapturesById`, so `canRenderEventDiffPlate` refused the verified plate and `resolveEventChangeQuietCopy` printed `EVENT_CHANGE_UNVERIFIED_COPY` — "no successful stored capture behind it" — while the succeeded capture sat in D1, unloaded.

Loader-only fix per the binding judge edits: after the `?event=` pin block, the loader unions in the loaded events' referenced captures via one new `listProofCapturesByIds(env, watchlistId, ids)` call (added to `app/lib/data/watchlist-proof.server.ts`, watchlist-scoped through the `proof_target` join, `queryIn` like its siblings). The merged list becomes `recentProofCaptures`, so every rendered event resolves its own capture; `buildProofSummary` keeps the original 12-recent input so summary semantics do not shift. No copy constants or component code changed.

## RED -> GREEN

RED (before the fix — `tests/event-changes-section.test.tsx`, committed first at 5b70b7be):

```
FAIL  loads the event's stored capture by id so the map can resolve it
AssertionError: expected "vi.fn()" to be called with arguments: [ Anything, 'watch-1', ...(1) ]
Number of calls: 0

FAIL  never claims there is no successful stored capture behind a verified change
AssertionError: expected '<section ...>' not to contain 'no successful stored capture'
Received: "...Recorded, not verified. This change has no successful stored
capture behind it, so we do not show it as a before-and-after...</p>..."
```

GREEN (after the fix): the loader calls `listProofCapturesByIds(env, "watch-1", ["cap-old"])`, the capture lands in `recentProofCaptures`, and the verified `f9-evidence-diff-plate` renders.

## Verification

```
$ npx vitest run tests/event-changes-section.test.tsx --configLoader runner --project node
 Test Files  1 passed (1)   Tests  2 passed (2)

$ npx vitest run tests/watchlists.route.test.ts tests/watchlist-route-loader.test.ts tests/event-changes-section.test.tsx --configLoader runner --project node
 Test Files  3 passed (3)   Tests  38 passed (38)

$ npx vitest run --configLoader runner --project node --changed origin/main
 Test Files  325 passed (325)   Tests  4146 passed (4146)
```

run-proof: `npx vitest run --configLoader runner --project node --changed origin/main` -> 325/325 files, 4146/4146 tests green (exit 0).

Typecheck is CI-owned (`npm run typecheck` runs in `ci.yml`); per fleet-ops#4891 / repo AGENTS.md it is intentionally not run inside the worker.

## Same-pattern sweep (do-step 3)

Only this loader paired a bounded recent-capture list with a wider event set:

- `app/lib/report-loader.server.ts` — uses `listProofCapturePairsForEventIds` (per-event fetch). Already correct.
- `app/lib/digest-orchestration.server.ts` — event->capture via `listProofCapturePairsForEventIds`; its `listRecentProofCapturesForWatchlist` call is period triage counting, not id-paired. Already correct.
- `app/lib/monitoring.server.ts`, `app/lib/first-brief.server.ts`, `app/lib/digest-email.server.ts` — only check `proofCaptureId` presence, never resolve through a bounded map.
- `app/routes/api.v1.$resourceType.$resourceId.ts`, `app/routes/api.mcp.ts` — do not touch `proofCaptureId`.

No other instance to fix.

## Manager-mode record (difficulty: heavy)

Plan: `.fleet/plan.md` (3 phases). Phase outputs:

- Phase 1 — RED test (`tests/event-changes-section.test.tsx`): reviewer verdict PASS; all seven checks NOTED; CONSIDER carried forward — the fix must import `listProofCapturesByIds` through the `~/lib/data.server` barrel (it does, via lazy `await import` matching the file's `listWatchEventsByIds` pattern, because the strict `vi.doMock` in `tests/watchlist-route-loader.test.ts` rejects an undeclared top-level destructure).
- Phase 2 — query fn + barrel + loader union: reviewer verdict PASS. CONSIDER (noted, not acted): the unioned `recentProofCaptures` also feeds `classifyWatchPeriodTriage` — an event-referenced older non-succeeded capture can inform triage copy in the no-confirmed-events case; truthful data, spec-conformant, and the confirmed-events path short-circuits earlier anyway. NOTED: `recent-evidence-checks-card` tail-fill when <4 recents — honest data.
- Phase 3 — affected-tests sweep caught one regression: `tests/watchlists.route.test.ts` strict `data.server` mocks lacked the new export while driving the loader with a capture-bearing event. Fixed by adding `listProofCapturesByIds: vi.fn().mockResolvedValue([])` to the three `data.server` mock blocks — a test-helper change required by the strict mocks; no assertions changed.

net-positive-because: the fix adds one new data-layer function plus its RED->GREEN regression test; the bulk of the added lines are the new test file.

Closes #2477

## Reviewer round (pre-arm)

Independent reviewer pass over `origin/main...HEAD` — verdict **APPROVE**, zero ACT-ON findings. Seat resolution: `fleet-review-arm-check` exit 0; `find_senior_seat` reported the senior ladder walled and fell through to `opencode/nemotron-3-ultra-free`.

- NOTED: union/dedupe/ordering verified; ≤26 bound params; tenant scoping via `proof_target.watchlist_id` join; `?event=` pinned events covered too.
- NOTED: `classifyWatchPeriodTriage` concern from phase 2 settled — event `proofCaptureId`s always point at `succeeded` captures (verified across every `createWatchEvent` call site), so triage's failed/pending/skipped branches can't trip.
- CONSIDER: `buildRunHistoryRefusalRows` may surface an old event-referenced suppressed-validity capture — honest data, bounded.
- NOTED: unguarded `listProofCapturesByIds` await matches the file's fail-closed posture (same as the sibling detail queries).
- DISMISSED: a plan.md doc nit about top-level destructure semantics — the lazy barrel import is correct regardless.
