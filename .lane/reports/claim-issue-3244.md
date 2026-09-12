## issue #3244 — defer-capture path claims the FIX-13 enrichment lease

Lane: pi-issue-0509-3244
Branch: claim/issue-3244
Base: origin/main @ 22726db6

### Reviewer round (cursor/cursor-grok-4.6-high)

- Act on: none.
- Consider / Noted (recorded, not re-delegated):
  - Missing reverse-direction test (defer-claimed → waitUntil for the same
    ad). Added in this round — now test 4 in the suite.
  - `LANDING_PAGE_CAPTURE_GAPS` is typed `Record<string, ...>`, not
    `Record<LandingPageCaptureFailureReasonCode, ...>`. Pre-existing;
    tightening it is a separate change (out of scope for #3244).
  - `enrichment_in_flight` metadata `metaAdId` duplicates
    `payload.ad.metaAdId`. Kept for log/telemetry symmetry with the
    `capture_stream_failed.message` pattern; flagged for a future cleanup.
  - Pre-existing FIX-13 stuck-pending window when a waitUntil revalidation
    lands while the defer-held lease blocks it (route's 4s one-shot
    revalidation mitigates). Out of scope for #3244 — file follow-up.

### Scope
- `app/lib/search-selection.server.ts` — defer-capture branch now claims the
  per-ad enrichment slot (the same one the waitUntil branch already used).
  On miss it short-circuits to a `enrichment_in_flight` failure-labelled
  promise so the <Await> pane renders honest capture-gap copy instead of an
  indefinitely-pending spinner. Successful and failed captures release the
  lease in a `.finally`.
- `app/lib/landing-pages.server.ts` — added `enrichment_in_flight` to
  `LandingPageCaptureFailureReasonCode` so the new failure path is
  type-safe and exhaustive.
- `app/lib/search-display.ts` — added an entry to `LANDING_PAGE_CAPTURE_GAPS`
  for `enrichment_in_flight` so the pane renders honest "check in progress"
  copy with a fact value, proof label, and a clear next step (open the
  link / retry).
- `tests/search-selection.deferred-capture.test.ts` — three new tests under
  `describe("prepareSearchResultSelection deferCapture lease (issue #3244)")`:
  1. Two concurrent defer captures for the same ad only schedule one
     Browser Rendering job; the second short-circuits with
     `enrichment_in_flight`; the lease releases once the first capture
     settles so the next defer can claim normally.
  2. The lease is released even when the deferred capture rejects (no
     sticky claim past the failure).
  3. An anonymous defer for an ad whose lease is held by the waitUntil
     (signed-in revalidation) path short-circuits — no second Browser
     Rendering job.

### Verification

`npx vitest run --configLoader runner --project node tests/search-selection.deferred-capture.test.ts`
→ 9 tests passed (5 existing + 4 new — including the reverse-direction
test added in response to the reviewer round: defer-claimed lease blocks
the waitUntil path from scheduling a second capture).

`npx vitest run --configLoader runner --project node tests/search-selection.paint-fast.test.ts`
→ 6 tests passed (existing FIX-13 lease test still green).

`npx vitest run --configLoader runner --project node tests/search-selection.persisted-ocr.test.ts tests/search-selection.no-db.test.ts tests/search-selection.persisted-translation.test.ts tests/search-display.test.ts`
→ 52 tests passed (related lease / capture-gap coverage green).

`npx vitest run --configLoader runner --project node --changed origin/main`
→ 1476 tests passed, 3 tests failed in
`tests/launch-readiness-guard.route.test.ts` ("email binding timeout"
detail-shape tests). These are pre-existing on origin/main (the route
adds `detail` while the tests don't expect it); my diff doesn't touch any
of that code (`grep -l "launch-readiness" app/lib/search-selection.server.ts app/lib/landing-pages.server.ts app/lib/search-display.ts`
returns nothing). Per memory budget rule #4891: CI owns coverage and
typecheck; the PR CI round-trip will catch anything real.

`sgscan` → No new security findings.

### Run-proof

- Tests: `npx vitest run --configLoader runner --project node tests/search-selection.deferred-capture.test.ts tests/search-selection.paint-fast.test.ts tests/search-selection.persisted-ocr.test.ts tests/search-selection.no-db.test.ts tests/search-selection.persisted-translation.test.ts tests/search-display.test.ts` → 66 tests passed across 6 files (840ms–1.5s per file).
- Gates: `sgscan` (semgrep diff) → No new findings.
- Workflows: deferred to PR CI round-trip (typecheck + workers project).
