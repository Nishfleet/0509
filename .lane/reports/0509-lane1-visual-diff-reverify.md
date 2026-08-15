# BEFORE/AFTER VISUAL DIFFS ON CHANGE EVENTS — re-verified: watchlist-events half implemented by open PR #715; alert-payload half is a read-contract with no write side

**Status: evidence record.** The watchlist-events half of the item (side-by-side
previous vs current screenshot in watchlist change events) is implemented in
Nish's open PR #715 (`feat/lane1-visual-diff-watchlist-events-20260814`),
re-verified current against today's main. The alert-payloads half (email/Slack)
has rendering code in main but no producer writes the metadata keys that code
reads, so it cannot fire in production; completing it would require forking
PR #715 and editing the monitoring write path — outside an evidence lane's
authority. No product code touched by this lane.

Branch: `0509-lane1-visual-diff-reverify`
Base: `origin/main` at `128b48cf` (#753)

## Item (full text, from `0509-improvement-loop/backlog.md` line 137)

- [ ] Before/after VISUAL diffs on change events — side-by-side previous vs
      current screenshot in watchlist events and alert payloads
      [source: consolidated-gap-v1] [tier-2] [risk: green] [parity-risk]
      [unreviewed-by-opus]
  - observed: rivals (Visualping, SpyLand) ship before/after visuals as the
    baseline of "proof"; 0509's change events carry text+link and diff plates
    but no previous-vs-current screenshot comparison on the change event itself.

## Verdict

The item is **partially implemented** by PR #715 (`feat/lane1-visual-diff-watchlist-events-20260814`,
author nish3451, open since 2026-08-14, base `main`), re-verified against the
current live tree on 2026-08-15:

- `git merge-base origin/main origin/feat/lane1-visual-diff-watchlist-events-20260814`
  == `origin/main` tip (`128b48cf`) — the PR branch contains current main; it
  merges cleanly with no refresh needed.
- PR #715 `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED` only because its
  required checks re-ran after the latest main merge (head `dcfeb876`, pushed
  2026-08-15). CI on the refreshed head: codex-node-checks SUCCESS,
  required-verifier-integrity queued at verification time, Gitleaks SUCCESS,
  CodeRabbit SUCCESS. No failing check.
- The item's **watchlist-events half** is delivered exactly: the diff plate
  renders the previous capture's screenshot next to the current capture's
  screenshot, side by side, inside the Before/Now panes.
- The item's **alert-payloads half** (email/Slack) is NOT delivered by PR #715
  and cannot fire in current main: the renderers exist
  (`digest-email.server.ts` `renderLandingPageEvidenceHtml`,
  `renderCreativeThumbnailHtml`; `change-mark.ts` `BEFORE_IMAGE_KEYS` /
  `AFTER_IMAGE_KEYS`; `change-intelligence.ts` `digestCreativeMetadata`) but
  **no code writes** `beforeCreativeImageUrl` / `afterCreativeImageUrl` /
  `fromCreativeImageUrl` / `toCreativeImageUrl` into event metadata, and the
  proof-capture screenshot keys are not exposed as URLs anywhere (no serving
  route for `landing-pages/...` R2 keys in `workers/app.ts` at main).

## What PR #715 implements (acceptance mapping)

The PR diff vs main (445 insertions / 9 files) delivers the watchlist-events
acceptance criteria:

- **`app/lib/proof-screenshot.ts`** (new, isomorphic) — `proofScreenshotSrc`
  builds the app-relative artifact URL from a stored R2 key
  (`/artifacts/proof/<encoded key>`); `isValidProofScreenshotKey` gates keys to
  `landing-pages/YYYY-MM-DD/<uuid>.(jpeg|jpg|png|webp)` before any R2 access;
  `parseProofScreenshotPathname` round-trips the Worker path.
- **`app/lib/proof-screenshot.server.ts`** (new) — `serveProofScreenshot`
  mirrors the creative-thumbnail contract: raster-only (never SVG), immutable
  caching, etag passthrough, HEAD support, null on missing bucket binding so
  the caller's fallback runs.
- **`workers/app.ts`** — wires `/artifacts/proof/<key>` next to the creative
  thumbnails (unguessable-key model).
- **`app/components/evidence/diff-plate.tsx`** — `DiffCapture` gains optional
  `imageUrl`; each pane renders its stored capture screenshot under the changed
  token (lazy `<img>`, Evidence Desk frame `.f9-evidence-diff-shot`).
- **`app/components/watchlists/event-changes-section.tsx`** — `resolveEventDiffCaptures`
  wires the screenshot pair from `priorProofCapture.screenshotArtifactKey` +
  `proofCapture.screenshotArtifactKey`. **Pair gate:** both sides must have a
  screenshot on file or the plate stays text-only — one side is never half a
  side-by-side, matching the two-timestamp honesty contract.
- **`app/app.css`** — `.f9-evidence-diff-shot` frame (1px rule, square corners
  per Evidence Desk surface rule).

## What is still open (alert payloads)

- **Email:** `renderLandingPageEvidenceHtml` / `renderCreativeThumbnailHtml`
  in `app/lib/digest-email.server.ts:877-999` render a before/after image pair
  ONLY when `beforeCreativeImageUrl`/`afterCreativeImageUrl` (or
  `fromCreativeImageUrl`/`toCreativeImageUrl`) are present in event metadata —
  and nothing writes those keys today (grep: only tests and readers).
- **Slack/instant alerts:** `app/lib/slack.server.ts` / `slack-webhook.server.ts`
  carry no image payloads at all.
- **Serving:** main has no route for `landing-pages/...` R2 keys; PR #715 adds
  the serving route, so once merged, the email half needs only the metadata
  write (attaching the two capture keys as URLs at event-creation time, at
  `app/lib/monitoring.server.ts:3646-3709` where the current and previous
  proof captures are both in scope).

## Verification run (this lane)

On the PR head `dcfeb876` (temporary worktree `/tmp/pr715-verify`, since
removed):

| Check | Result |
| --- | --- |
| `tests/proof-screenshot.server.test.ts` | 12 tests passed |
| `tests/evidence-diff-plate.test.tsx` | 8 tests passed |
| `tests/watchlist-change-feed.test.tsx` | 27 tests passed |
| Total | 3 files / 47 tests passed |
| `tsc --noEmit` | exit 0 |

The PR author previously reported full Vitest, typecheck, and build green on an
earlier head; CI on the refreshed head was queued/partially complete at
verification time (no failing check).

## Why no new PR was opened

- Opening a second PR that re-implements the already-open, mergeable watchlist
  PR #715 would fork the work and conflict with it. The watchlist-events half
  is done in PR #715; landing that PR (author: Nish) is the remaining step and
  is outside this lane's authority (packet forbids pushing to main; merging is
  a shared-state action).
- The alert-payloads half is a real remaining gap, but completing it requires
  editing the proof-event write path (`monitoring.server.ts`) with a metadata
  contract that must not conflict with #715's read contract, plus alert
  rendering changes — that is implementation work for a feature lane, not an
  evidence close-out, and the packet's own history shows this lane's contract
  is re-verification with evidence.

## Files

- `.lane/reports/0509-lane1-visual-diff-reverify.md` — this evidence record
  (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
