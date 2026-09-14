# Lane evidence — claim/issue-3429 (Nishfleet/0509#3429)

Unit: pi-issue-0509-3429. Carrier for #3322's acceptance-3 (72h observe) +
the post-deploy half of acceptance-2. Resumed from salvage
`wip/pi-issue-0509-3429-20260914T090110Z` @ c3f5a80de after the prior unit
died exit-code/1 with the burst already complete.

## What the prior unit proved (salvaged, re-verified live)

- Deploy precondition: #3427 merged 2026-09-13T22:40Z; Deploy production
  run 34798996355 on 16bd92843 succeeded 02:22Z.
- Burst through the product's own surface, zero direct D1 writes:
  signup -> `magic_link_dispatched` token via `wrangler tail` (post-1.7.1
  D1 verification.identifier is the hash) -> forged-state staging ->
  confirm -> POST /app/watchlists import. ok=20 fail=0 (+1 probe).
- D1 (re-verified 2026-09-14T09:45Z): watchlist=22 total / 21 cohort,
  watchlist_run=26, delivery_attempt lane=customer sent=63,
  digest_item=22 all ad_new.
- First non-vacuous guard reads: canary-cta-detector measured a real
  21-active-watchlist cohort (exit 1, honest 0 cta events — baselines
  only); canary-digest-headline-ratio exit 0 with 20 real collapsed
  items; 0509-digest-headline-ratio-guard.timer armed (next 15:23 IST).
- Evidence comment posted on #3322 (~09:00Z) covering burst, D1
  receipts, guard reads, and the date-gated leftovers.

## This run's delta

- Re-verified every receipt live (commands in .fleet/phase-2-receipts.md).
- Landed the salvaged artifacts: patched .fleet/burst-3322.sh +
  .fleet/phase-2-receipts.md; fixed a dead fallback default in the
  script's domain list.
- accept-4 honored: #3380 closed via #3451, dedupe clause inert, no
  hand-filed marker issue.

## Date-gated leftovers (cannot be done before their dates)

- 72h observe window ends ~2026-09-17T02:22Z (deploy + 72h).
- Weekly scheduled scan window Mon 2026-09-21 05:00-08:00 IST (#2406):
  record whether the tick scans the cohort — second-scan mechanism
  finding for BET 1. Queued as a follow-up issue; also recorded on
  #3322's evidence comment.
- accept-5: a real guard fire needs second scans; none yet.
