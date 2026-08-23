# BEFORE/AFTER VISUAL DIFFS ON CHANGE EVENTS — alert payloads landed (PR pending)

**Status: implementation complete; tests + typecheck green; PR push pending.**

The watchlist-events half of the item shipped in PR #715 (`feat/watch:
side-by-side before/after screenshots on watchlist change events`, commit
`feb1d460`, landed 2026-08-17). This lane completes the alert-payloads
half: digest emails and instant alert emails now render the same
side-by-side before/after screenshot pair that the watchlist event diff
plate shows, gated by the same two-screenshot pair contract (both sides
must be on file, or the plate stays text-only — never half a side-by-side).

Branch: `0509-lane1-visual-diff-alert-payloads`
Base: `origin/main` at `57a73d5f` (post-#715)

## Item (full text, from `0509-improvement-loop/backlog.md` line 137)

- [ ] Before/after VISUAL diffs on change events — side-by-side previous vs
      current screenshot in watchlist events and alert payloads
      [source: consolidated-gap-v1] [tier-2] [risk: green] [parity-risk]

## What landed

- **Digest pipeline (`app/lib/digest-orchestration.server.ts`)** — added
  `loadDigestScreenshotPairs` and `digestScreenshotMetadata`. The
  orchestration now batch-loads the proof-capture pair for every
  digest-eligible event via `listProofCapturePairsForEventIds` (one bounded
  query, never N+1) and, when BOTH sides of the pair carry a stored
  `screenshotArtifactKey`, attaches absolute HTTPS URLs to the item
  metadata as `beforeCreativeImageUrl` / `afterCreativeImageUrl`. The
  existing digest-email renderers (`renderCreativeThumbnailHtml`,
  `readLandingPageEmailEvidence`) already read these keys and validate them
  via `safeHttpsImageUrl` — so the renderer side is unchanged, only the
  write half is new. Pair gate mirrors the watchlist event diff plate: any
  missing side degrades to the existing pending copy, never a half-pair
  image.
- **Instant alert pipeline (`app/lib/delivery.server.ts`)** — added
  `loadAlertScreenshotPairs` mirroring the existing
  `loadAlertEvidenceStates` (fail-closed empty map on missing helper or
  thrown query, same shape and strict-mock handling). `buildInstantAlertContent`
  now takes an optional `screenshotPairsByEventId` and `renderEventDiffHtml`
  renders the side-by-side screenshots above its existing text-only
  before/now row when both URLs are present. Falls back to the text-only
  row when the pair is absent, partial, or the helper is missing.
- **URL builder (`app/lib/proof-screenshot.server.ts`)** — added
  `proofScreenshotAbsoluteUrl(env, key)` which composes
  `proofScreenshotSrc(key)` (the app-relative artifact path PR #715 added)
  with `appBaseUrl(env)` so email clients (which refuse relative `<img
  src>` paths) get an absolute HTTPS URL. Returns null for missing or
  malformed keys; never fabricates a URL.
- **Tests** — added `tests/visual-diff-alert-payloads.test.ts` covering the
  digest write side (pair present → URLs written; missing one side → no
  URLs; missing previous → no URLs; missing helper → no URLs, no crash)
  plus 2 new tests in `tests/delivery.server.test.ts` covering the instant
  alert render (pair present → both `<img>`s render; absent → text-only,
  no `/artifacts/proof/` substring) and 3 new tests in
  `tests/proof-screenshot.server.test.ts` for `proofScreenshotAbsoluteUrl`
  (origin resolution, BETTER_AUTH_URL fallback, null-on-missing).

## Verification run (this lane)

```
$ /home/nish/workspaces/products/0509/node_modules/.bin/tsc --noEmit
EXIT: 0

$ /home/nish/workspaces/products/0509/node_modules/.bin/vitest run \
    tests/digest-email.test.ts \
    tests/delivery.server.test.ts \
    tests/proof-screenshot.server.test.ts \
    tests/visual-diff-alert-payloads.test.ts \
    tests/digest-triage-orchestration.test.ts \
    tests/digest-strategy.server.test.ts \
    tests/watchlist-change-feed.test.ts \
    tests/evidence-diff-plate.test.ts
 Test Files  8 passed (8)
      Tests  188 passed (188)
```

No existing tests were modified to compensate for the new code paths; the
existing test suite (digest-email, delivery.server, proof-screenshot,
digest-triage-orchestration, digest-strategy, watchlist-change-feed,
evidence-diff-plate) continues to pass unchanged.

## Honest contract preserved

The pair gate is identical to PR #715's watchlist event diff plate:

1. Both sides (`proofCapture.screenshotArtifactKey` AND
   `priorProofCapture.screenshotArtifactKey`) must be non-null.
2. Either side missing → the pair is not written; the alert falls back to
   the existing text-only before/now rendering (digest) or the
   "Screenshot proof pending" copy (digest landing-page card).
3. No fabrication: `proofScreenshotAbsoluteUrl` returns null on a malformed
   key, and the helpers short-circuit on missing `listProofCapturePairsForEventIds`
   to an empty map (the alert becomes text-only, never blocked, never
   imagined).
4. Slack channel is intentionally out of scope: the existing
   `sendSlackWebhookUrl` carries no image payload today and the item asks
   for visual proof, which requires a screenshot channel. Adding Slack
   image attachments is a separate surface (different webhook payload
   shape) and would require a follow-up lane.

## Files

- `app/lib/proof-screenshot.server.ts` — `proofScreenshotAbsoluteUrl` helper
- `app/lib/digest-orchestration.server.ts` — pair loader + metadata merge
- `app/lib/delivery.server.ts` — alert pair loader + render in
  `renderEventDiffHtml`
- `tests/visual-diff-alert-payloads.test.ts` — new, 4 tests
- `tests/delivery.server.test.ts` — +2 tests for screenshot rendering
- `tests/proof-screenshot.server.test.ts` — +3 tests for the absolute URL
  builder
- `.lane/reports/0509-lane1-visual-diff-alert-payloads.md` — this report

## Rollback

N/A — additive metadata + a guarded email-render branch. Reverting the
diff plate PR (PR #715) and this lane's commit would restore the
pre-change alert rendering exactly: text-only before/now, no screenshot
URLs, no broken `<img>` tags. The pair gate ensures a missing key
degrades to text-only, not a broken image.
