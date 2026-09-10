reccos: gate the marketing H1 "live" flag on `heroProofLive` (issue #2313)

## What
The hero wall's `<i class="ld-flag">live</i>` stamp ("running right now.live")
rendered unconditionally, even above a proof strip that was a 16-hour-old
cached brief labeled "On record". This PR renders the flag only when the
marketing loader's `heroProofLive` is true — a single conditional in
`heroWall` — so an on-record proof ends the wall at "running right now." with
no flag. This holds the same freshness discipline as /search
(AUDIT-SEARCH-PREVIEW-FRESHNESS): the product must not claim "right now"
unless proven fresh.

The marketing loader already exposes `heroProofLive`
(`proofBrief.freshForLiveClaim && !heroCaptureStale`, where
`heroCaptureStale` compares the capture age against `PROOF_CAPTURE_FRESH_DAYS`
= 30 days via `captureAgeDays`). No threshold was invented; the existing
freshness boundary is reused.

## Files
- `app/routes/marketing.tsx` — gate the flag on `heroProofLive` in `heroWall`.
- `tests/marketing-proof-brief.test.tsx` — new freshness-gate tests.
- `tests/homepage-hero-direction.test.tsx` — aligned the #2170 live-proof case
  to a genuinely-live fixture and added an on-record flag-absent case.

## Verification
Real run results on the touched area (`node` project):
- `vitest run --configLoader runner --project node tests/marketing-proof-brief.test.tsx`
  → 1 file, 9 tests passed (7 existing + 2 new).
- `vitest run --configLoader runner --project node tests/homepage-hero-direction.test.tsx tests/marketing-proof-brief.test.tsx`
  → 2 files, 15 tests passed.
- `vitest run --configLoader runner --project node tests/design-system/hero-viewport.test.tsx tests/marketing-nav.test.ts tests/marketing-rebuild.test.ts tests/marketing-pricing-fetch.test.tsx`
  → 4 files, 45 tests passed.

run-proof: no new systemd units, timers, path units, or GitHub workflows;
this is a source + test diff only, verified by the real test runs above.

## Accept (judge edits applied)
- marketing test with a 16h-old capture fixture ⇒ no "live" flag (new test
  "renders no ld-flag when the proof capture is 16h old (on record, not live)").
- fixture at the loader's existing freshness boundary ⇒ flag present. Boundary
  value stated in the test name: **30 days** (`PROOF_CAPTURE_FRESH_DAYS`), test
  "renders the ld-flag at the loader's existing freshness boundary (30 days,
  PROOF_CAPTURE_FRESH_DAYS) when freshForLiveClaim is true".
- stale/on-record flag-absent keeps the wall (new test in
  homepage-hero-direction.test.tsx).

net-positive-because: test coverage for the new conditional (flag freshness gate) is the net-positive addition — production diff is 5 insertions / 1 deletion; the rest of the additions are test files pinning the new behavior.

## Reviewer round (one round, pre-arm)
Reviewer seat: `cursor/cursor-grok-4.6-high` (find_senior_seat first usable entry).

Findings adjudication:
- Act on: none.
- Consider: the 16h fixture's no-flag is driven by `freshForLiveClaim: false` (16h < 30-day window), so the 16h figure doesn't itself exercise the staleness gate — acceptance still met; the 30-day boundary test proves the loader-gate path. Recorded as Consider; no action.
- Noted: boundary test deterministic (strict `> 30`; floor stays 30 under sub-second drift); boundary value "30 days, PROOF_CAPTURE_FRESH_DAYS" stated in test name; loader exposes heroProofLive exactly as the judge note required; no invented threshold.
- Dismissed-with-reason: 16h fixture plumbed through fetchedAt/proofTrail[0].capturedAt per loader read at line 481 — correct; the pre-existing #2170 test gained assertions and moved to a genuinely-live fixture, not weakened/skipped.

Reviewer confirmed all 15 touched tests pass.

## Test plan
`npx vitest run --configLoader runner --project node tests/marketing-proof-brief.test.tsx tests/homepage-hero-direction.test.tsx`

Closes #2313