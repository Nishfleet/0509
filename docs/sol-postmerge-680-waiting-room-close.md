# sol-postmerge-680 waiting-room close-out

Date: 2026-08-14

## Report

Source report: /home/nish/workspaces/agent-state/0509-improvement-loop/sol/postmerge-680.md

## Verdict

Finding HOLDS.

PR #680 changed `freshForLiveClaim` from `ageMs <= 120000` to
`ageMs < 120000` but left two clocks on the public brand page: the snapshot
computes the live-claim flag from a `now` captured before awaited D1 reads,
while the route formats `checkedAgo` from a later `now`. At the moments-ago
boundary (119999 ms + a 2 ms read gap) the page still rendered "is running …
right now" next to "Last checked about 2 minutes ago".

## Named default honored

Post-merge defect is machine-ownable work. Public `/ads/:domain` now derives
the live claim and the freshness stamp from one post-read clock via
`resolveBrandPageFreshness` — `freshForLiveClaim` is true if and only if
`checkedAgo` is "moments ago", so the shipped "can never disagree" promise
holds on the public page.

## What was NOT done

- No threshold change: `BRAND_PAGE_MOMENTS_AGO_MS` and
  `BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS` untouched, indexing age and cache
  lookup count untouched.
- No deploy, no migration, no payment/checkout/pricing edits, no
  auth-flow change.
- No copy-string changes; only comments documenting the one-clock rule.
- No push, no PR — orchestrator owns push + PR after proof.

## Files changed

- app/lib/brand-page.server.ts — `resolveBrandPageFreshness` one-clock
  helper added; `toUsableSnapshot` derives `freshForLiveClaim` from it
- app/routes/ads.$domain.tsx — loader derives both `checkedAgo` and
  `freshForLiveClaim` from one post-read `now` via the helper
- tests/ads-brand-page.signals.test.ts — helper pairing tests at
  0 / 119999 / 120000 / 120001 / 5 minutes
- tests/ads-brand-page.route.test.ts — two-clock loader regression
  (119999 ms capture + 2 ms cache-read gap)
- docs/sol-postmerge-680-waiting-room-close.md — this close-out

## Rollback

Revert the product change (the one-clock `resolveBrandPageFreshness` wiring
in app/lib/brand-page.server.ts and app/routes/ads.$domain.tsx) via
`git revert`. Triage Disposition stays QUEUED.
