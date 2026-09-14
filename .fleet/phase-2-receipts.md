# Phase-2 receipts — issue 3429 (claim/issue-3429)

Post-deploy cohort burst + the #1451 guards' first non-vacuous measurements.
Unit pi-issue-0509-3429, run 2026-09-14 ~08:30–09:05Z. Deploy precondition:
PR #3427 merged 2026-09-13T22:40Z; Deploy production run 34798996355 on
16bd92843 succeeded 2026-09-14T02:22Z (the 0102-migration ledger break was
reconciled by #3446).

## Mechanic changes proven this run (burst-3322.sh patched accordingly)

1. Token source: post-1.7.1 `storeToken:"hashed"` means
   `verification.identifier` in D1 is the HASH — not redeemable. The raw token
   only exists in the `magic_link_dispatched` structured log line
   (better-auth.server.ts:259). Script now runs its own
   `wrangler tail 0509 --format json` and pulls `token=` out of the logged
   `url` (verify-URL shape, 32-char raw token, 15-min TTL).
2. Import endpoint: `POST /app` returns 405 on the deployed worker; the same
   intent works on `POST /app/watchlists` (watchlist-route-actions ->
   handleSetupChecklistAction). Proven: 302 -> /app/onboard?step=first-brief.
3. Probe (email bet1-3322-probe@0509.io, domain shein.com) ran the whole chain
   by hand first: signup 302 -> tail token -> forged-state stage 302 ->
   confirm 302 /app + session cookie -> import 302 first-brief -> watchlist
   row `c2e3db37` "Shein watch" 08:42:46Z.

## Burst result

`bash .fleet/burst-3322.sh 1 3` then `4 20`: ok=20 fail=0 — every iteration
signup:302 stage:302 confirm:302 import:302/onboard-first-brief.

## D1 receipts (2026-09-14T08:59:49Z)

- watchlist = 22 total; cohort (bet1-3322-*@0509.io) = 21 watchlists / 21 users
  (probe + 20 burst). Only other row: launch-readiness-canary-watchlist.
- watchlist_run = 26 (24 succeeded, 1 running, 1 skipped);
  20/21 cohort watchlists have last_scanned_at set — the queued first scans
  (#3451) are landing.
- digest_item = 22, all event_type=ad_new (creative churn — first scans set
  baselines; landing_page_* diffs need a second scan).
- delivery_attempt = 75 total; lane=customer status=sent = 63
  (62 of them today, post-burst; pre-burst baseline was 1).

## Guard measurements (first non-vacuous reads, ~08:57Z)

- `node scripts/canary-cta-detector.mjs --json` -> exit 1:
  `{"watchlistCohort":25,"row":{"ctaEventCount":0,"activeWatchlistCount":19,...}}`
  — the detector now measures a real 19-active-watchlist cohort (was 1).
  0 landing_page_cta_changed events is honest: a minutes-old cohort has
  baselines, no diffs yet.
- `node scripts/canary-digest-headline-ratio.mjs` -> exit 0:
  period 2026-09-14: 0 landing_page_* / 0 headline-stream items, 16
  creative-churn items collapsed; rolling 0 measured days, ratio 0.000,
  verdict ok. First day the guard saw delivered items at all.
- `systemctl --user list-timers | grep digest-headline-ratio`:
  0509-digest-headline-ratio-guard.timer NEXT 2026-09-14 15:23 IST — armed.

## Date-gated leftovers (recorded on #3322's evidence comment too)

- Weekly scheduled scan window Mon 2026-09-21 05:00-08:00 IST (#2406):
  check `SELECT COUNT(*) FROM watchlist_run WHERE created_at >= '2026-09-21'`
  after the tick — scans-cohort vs not is the BET-1 second-scan finding.
- 72h observe window runs to ~2026-09-17T02:22Z (deploy + 72h).
- Marker dedupe: #3380 closed 2026-09-14 via #3451 — the dedupe-onto-#3380
  clause is inert; a real guard fire on second-scan data files fresh.
- No hand-filed marker issue created (accept-4 honored).
