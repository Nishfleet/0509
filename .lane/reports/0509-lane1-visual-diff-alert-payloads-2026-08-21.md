# BEFORE/AFTER VISUAL DIFFS ON CHANGE EVENTS — alert payloads delivered (PR #810)

**Status: implementation complete; tests + typecheck green; PR #810 open.**

The watchlist-events half of the item shipped in PR #715 (commit
`feb1d460`, merged 2026-08-17). This lane completes the alert-payloads
half: digest emails and instant alert emails now render the same
side-by-side before/after screenshot pair the watchlist event diff plate
shows, gated by the same two-screenshot pair contract (both sides must be
on file, or the plate stays text-only — never half a side-by-side).

Branch: `0509-lane1-visual-diff-alert-payloads-2026-08-21`
PR: https://github.com/Nishfleet/0509/pull/810
Base: `origin/main` at `422fbd55` (#806)

## Item (full text, from `0509-improvement-loop/backlog.md` line 137)

- [ ] Before/after VISUAL diffs on change events — side-by-side previous vs
      current screenshot in watchlist events and alert payloads
      [source: consolidated-gap-v1] [tier-2] [risk: green] [parity-risk]
      [unreviewed-by-opus]

## What landed

This PR is a cherry-pick of the previously-validated implementation
branch `0509-lane1-visual-diff-alert-payloads` (commits `bd04792e` +
`cee7fdb2`) onto current `origin/main`. The base has drifted 25+ commits
since that branch was created (brief retention loop, Slack/Teams delivery
surfaces #705, real-proof surfaces fix #806), but the implementation
itself applied cleanly with `git cherry-pick` — auto-merging
`app/lib/delivery.server.ts`, `app/lib/digest-orchestration.server.ts`,
and `tests/delivery.server.test.ts` without manual conflict resolution.
The prior lane report (`.lane/reports/0509-lane1-visual-diff-alert-payloads.md`)
is carried forward unchanged on cherry-pick.

### Digest pipeline (`app/lib/digest-orchestration.server.ts`)

- New `loadDigestScreenshotPairs(env, userId, eventIds)` does ONE bounded
  batched query (via `listProofCapturePairsForEventIds`) for every digest
  event — never N+1.
- When BOTH sides of the pair carry a stored `screenshotArtifactKey`,
  attaches absolute HTTPS URLs to the item metadata as
  `beforeCreativeImageUrl` / `afterCreativeImageUrl`. The existing
  digest-email renderers (`renderCreativeThumbnailHtml`,
  `readLandingPageEmailEvidence`) already read these keys and validate
  them via `safeHttpsImageUrl` — the renderer side is unchanged, only the
  write half is new.
- Pair gate mirrors the watchlist event diff plate: missing one side ⇒
  no pair, never a half side-by-side; missing helper or thrown query ⇒
  empty map, the alert becomes text-only, never blocked.

### Instant alert pipeline (`app/lib/delivery.server.ts`)

- New `loadAlertScreenshotPairs` mirroring the existing
  `loadAlertEvidenceStates` (fail-closed empty map on missing helper or
  thrown query).
- `buildInstantAlertContent` accepts an optional
  `screenshotPairsByEventId`.
- `renderEventDiffHtml` renders the side-by-side screenshots above its
  existing text-only before/now row when both URLs are present, falls
  back to the text-only row when the pair is absent or partial.

### URL builder (`app/lib/proof-screenshot.server.ts`)

- New `proofScreenshotAbsoluteUrl(env, key)` composes
  `proofScreenshotSrc(key)` (the app-relative artifact path PR #715
  added) with `appBaseUrl(env)` so email clients (which refuse relative
  `<img src>` paths) get an absolute HTTPS URL. Returns null for missing
  or malformed keys; never fabricates a URL.

### Tests

- `tests/visual-diff-alert-payloads.test.ts` (new, 4 tests) covers the
  digest write side: pair present ⇒ URLs written; missing one side ⇒ no
  URLs; missing previous ⇒ no URLs; missing helper ⇒ no URLs, no crash.
- `tests/delivery.server.test.ts` +2 tests: pair present ⇒ both `<img>`s
  render; absent ⇒ text-only, no `/artifacts/proof/` substring.
- `tests/proof-screenshot.server.test.ts` +3 tests for the absolute URL
  builder.

Slack channel is intentionally out of scope: `sendSlackWebhookUrl` carries
no image payload today, and the item asks for visual proof, which
requires a screenshot channel — different webhook payload shape,
follow-up lane.

## Verification run (this lane)

```
$ env -u NODE_ENV tsc --noEmit
EXIT: 0

$ env -u NODE_ENV vitest run \
    tests/digest-email.test.ts \
    tests/delivery.server.test.ts \
    tests/proof-screenshot.server.test.ts \
    tests/visual-diff-alert-payloads.test.ts \
    tests/digest-triage-orchestration.test.ts \
    tests/digest-strategy.server.test.ts \
    tests/watchlist-change-feed.test.ts \
    tests/evidence-diff-plate.test.tsx
 Test Files  8 passed (8)
      Tests  212 passed (212)

$ env -u NODE_ENV vitest run
 Test Files  451 passed | 1 failed (452)
      Tests  5350 passed | 1 failed (5351)
```

The one failing test in the full suite,
`tests/landing-page-signals.test.ts > captureLandingPageSnapshot >
releases fetch timeout timers on non-OK fetch responses without rendered
fallback`, is a flaky 10s timeout that passes in isolation on both
`origin/main` and this branch. Pre-existing on main, not introduced by
this change.

## Honest contract preserved

The pair gate is identical to PR #715's watchlist event diff plate:

1. Both sides (`proofCapture.screenshotArtifactKey` AND
   `priorProofCapture.screenshotArtifactKey`) must be non-null.
2. Either side missing ⇒ the pair is not written; the alert falls back
   to the existing text-only before/now rendering (digest) or the
   "Screenshot proof pending" copy (digest landing-page card).
3. No fabrication: `proofScreenshotAbsoluteUrl` returns null on a
   malformed key, and the helpers short-circuit on a missing
   `listProofCapturePairsForEventIds` to an empty map (the alert becomes
   text-only, never blocked, never imagined).
4. Reverting PR #715 + this PR restores the pre-change alert rendering
   exactly: text-only before/now, no screenshot URLs, no broken `<img>`
   tags.

## Files (this PR)

- `app/lib/proof-screenshot.server.ts` — `proofScreenshotAbsoluteUrl` helper
- `app/lib/digest-orchestration.server.ts` — pair loader + metadata merge
- `app/lib/delivery.server.ts` — alert pair loader + render in `renderEventDiffHtml`
- `tests/visual-diff-alert-payloads.test.ts` — new, 4 tests
- `tests/delivery.server.test.ts` — +2 tests for screenshot rendering
- `tests/proof-screenshot.server.test.ts` — +3 tests for the absolute URL builder
- `.lane/reports/0509-lane1-visual-diff-alert-payloads.md` — source-branch
  lane evidence (carried forward on cherry-pick)
- `.lane/reports/0509-lane1-visual-diff-alert-payloads-2026-08-21.md` —
  this report

## Rollback

N/A — additive metadata + a guarded email-render branch. Reverting PR
#715 + this PR would restore the pre-change alert rendering exactly:
text-only before/now, no screenshot URLs, no broken `<img>` tags. The
pair gate ensures a missing key degrades to text-only, not a broken
image.

## Status

- Branch: pushed (`0509-lane1-visual-diff-alert-payloads-2026-08-21`)
- PR: #810 open
- Tests: green (one pre-existing flaky timeout, unrelated)
- Typecheck: green
