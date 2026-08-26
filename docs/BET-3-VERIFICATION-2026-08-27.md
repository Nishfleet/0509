# BET 3 — "The Offer Timeline" verification record

**Issue:** #974
**Date:** 2026-08-26T20:54:51Z
**Scope:** Verification-only. If the check fails, the blocking parts are not done.

## Termination check (§3.4 BET 3, verbatim)

> For a competitor watched ≥14 days, the timeline renders ≥3 dated offer states
> with working screenshot links; `landing_page_snapshot` row count >0 and
> growing daily; a share link to the timeline renders correctly logged out.
> Proof = the live URL plus the row-count delta.

**Result: FAIL.** The canary ran. The bet is still red. This record is the run,
not a close.

The detector is `npm run canary:bet3` (`scripts/bet3-live-verification.mjs`).
Re-run it against `https://0509.io` after production has the `#967` route and
`#968` backfill, and after a competitor has actually been watched for 14 days
with three screenshot-backed states.

## Dependencies

| Part | Issue | State | Live on 0509.io? |
|---|---|---|---|
| Snapshot store | #952 | closed 2026-08-25T08:00Z | Write path is in `main`. Production deploys have been red since. |
| Public `/timeline/:domain` | #967 | closed 2026-08-26T16:59Z | **No.** Every demo URL 404s. |
| Demo-brand backfill | #968 | closed 2026-08-26T19:27Z | **No.** Migration 0079 is in `main` and seeds one dated state per brand with an honest "no screenshot" label — not three screenshot-backed states, and not 14 days of watching. |

#952 closed about two days before this run. A competitor watched ≥14 days is a
date gate: the earliest honest pass is **2026-09-08**, and only if live
capture actually stores three screenshot-backed states rather than
fabricating them. #968's honesty contract forbids fabricated screenshots.

## Live run

Command:

```
npm run canary:bet3
```

Against `https://0509.io` at 2026-08-26T20:54:51Z, unauthenticated, exit 1:

```
BET 3 live verification @ https://0509.io
Probed 5 domain(s)
  verified: 0 | dead-ends: 0 | not_found: 5 | rate-limited: 0 | errors: 0
  share present: 0 | receipt links: 0 working / 0 broken
  total offer states observed: 0

Termination checks:
  FAIL timeline_route_reachable: non-200 responses: nike.com, nykaa.com, allbirds.com, lenskart.com, mamaearth.com
  FAIL demo_backfill_present: missing backfill for: nike.com, nykaa.com, allbirds.com, lenskart.com, mamaearth.com
  FAIL watched_competitor_three_screenshot_states: no probed domain has been watched >=14 days with >=3 dated states and working screenshot links
  FAIL share_link_present_and_logged_out: no probed domain rendered a matching canonical share URL
  PASS no_receipt_404s: no receipt links returned 404 or 5xx
  SKIP snapshot_row_count_positive: SKIP: landing_page_snapshot count not available (no D1 probe)
  SKIP snapshot_row_count_growing_daily: SKIP: growing-daily needs two observations; this run has no prior count
```

Per-URL (all logged-out GET, no cookies):

| URL | Status |
|---|---|
| https://0509.io/timeline/nike.com | 404 |
| https://0509.io/timeline/nykaa.com | 404 |
| https://0509.io/timeline/allbirds.com | 404 |
| https://0509.io/timeline/lenskart.com | 404 |
| https://0509.io/timeline/mamaearth.com | 404 |

`/ads/nike.com` still returns 200. The Worker is up. This path is missing
from the deployed Worker, not from DNS. Deploy production is red
(#1172 Gate-B journeys, #1152 D1 restore-evidence).

A SKIP is not a green run. The two D1 checks were skipped because this
public probe does not carry a Cloudflare API token. Pass
`BET3_SNAPSHOT_COUNT` and `BET3_PRIOR_SNAPSHOT_COUNT` on a later run to
measure the row-count delta.

## Why this is not a close

The issue's accept criteria are live, not "the code exists on main":

- A competitor watched ≥14 days with ≥3 dated offer states and working
  screenshot links — not in production, and not honest to seed.
- `landing_page_snapshot` row count >0 and growing daily — not measured.
- A share link that renders logged out — the share page 404s.

This canary does not fix those. It is how we know BET 3 is still red.

## Unit tests for the detector

```
npx vitest run --configLoader runner --project node tests/bet3-live-verification.test.ts
```

Result: **26 passed (26)** — parser, termination checks (including the 14-day
span and screenshot-link requirement), rate limiter, package.json lock, and
the rule that a D1 SKIP is not a pass.
