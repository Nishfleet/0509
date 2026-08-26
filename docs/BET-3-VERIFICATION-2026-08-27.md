# BET 3 — "The Offer Timeline" verification record

**Issue:** #974
**Scope:** Verification-only. If the check fails, the blocking parts are not done.

## Termination check (§3.4 BET 3, verbatim)

> For a competitor watched ≥14 days, the timeline renders ≥3 dated offer
> states with working screenshot links; `landing_page_snapshot` row count >0
> and growing daily; a share link to the timeline renders correctly logged
> out. Proof = the live URL plus the row-count delta.

The detector is `npm run canary:bet3` (`scripts/bet3-live-verification.mjs`).
Exit 1 unless every check PASSes. A D1 SKIP is not a pass.

## Live runs against https://0509.io

### Run 1 — 2026-08-26T20:54:51Z

Worker pre-deploy. All five `/timeline/:domain` URLs 404; the canary's
`timeline_route_reachable` and `demo_backfill_present` FAILed. Record of
the red state at the time the canary landed. The Worker was up (the
`/ads/nike.com` route returned 200), so the failure was missing deployed
bytes, not DNS.

### Run 2 — 2026-08-26T22:50:52Z

Worker post-deploy (merge `22389a3d` → production). Five URLs return 200,
each carries the demo-brand backfill (#968) and a logged-out share URL.
The canary's `timeline_route_reachable`, `demo_backfill_present`,
`share_link_present_and_logged_out`, and `no_receipt_404s` now PASS. The
remaining red is the **§3.4 watched-competitor gate** (no probed brand has
been watched ≥14 days with three screenshot-backed states — a date gate,
not a code gap) and the two `landing_page_snapshot` SKIPs (the public
canary has no Cloudflare API token; pass `BET3_SNAPSHOT_COUNT` and
`BET3_PRIOR_SNAPSHOT_COUNT` when a later run can see the table).

```
BET 3 live verification @ https://0509.io
Probed 5 domain(s)
  verified: 5 | dead-ends: 0 | not_found: 0 | rate-limited: 0 | errors: 0
  share present: 5 | receipt links: 0 working / 0 broken
  total offer states observed: 5

Termination checks:
  PASS timeline_route_reachable: all probed domains returned HTTP 200
  PASS demo_backfill_present: all 5 demo brand domains have >=1 offer state
  FAIL watched_competitor_three_screenshot_states: no probed domain has been watched >=14 days with >=3 dated states and working screenshot links
  PASS share_link_present_and_logged_out: share URL present and logged out on: nike.com, nykaa.com, allbirds.com, lenskart.com, mamaearth.com
  PASS no_receipt_404s: no receipt links returned 404 or 5xx
  SKIP snapshot_row_count_positive: SKIP: landing_page_snapshot count not available (no D1 probe)
  SKIP snapshot_row_count_growing_daily: SKIP: growing-daily needs two observations; this run has no prior count
```

Per-URL (all logged-out GET, no cookies):

| URL | Status | Offer states | Share URL |
|---|---|---|---|
| https://0509.io/timeline/nike.com | 200 | 1 (no screenshot, backfill label) | https://0509.io/timeline/nike.com |
| https://0509.io/timeline/nykaa.com | 200 | 1 (no screenshot, backfill label) | https://0509.io/timeline/nykaa.com |
| https://0509.io/timeline/allbirds.com | 200 | 1 (no screenshot, backfill label) | https://0509.io/timeline/allbirds.com |
| https://0509.io/timeline/lenskart.com | 200 | 1 (no screenshot, backfill label) | https://0509.io/timeline/lenskart.com |
| https://0509.io/timeline/mamaearth.com | 200 | 1 (no screenshot, backfill label) | https://0509.io/timeline/mamaearth.com |

A SKIP is not a green run. The two D1 checks were skipped because this
public probe does not carry a Cloudflare API token. Pass
`BET3_SNAPSHOT_COUNT` and `BET3_PRIOR_SNAPSHOT_COUNT` on a later run to
measure the row-count delta.

## Why this is not yet a close

The issue's accept criteria are live, not "the code exists on main":

- A competitor watched ≥14 days with ≥3 dated offer states and working
  screenshot links — date gate. The honest backfill in #968 has one state
  per brand (no screenshot). Fabricating screenshots is forbidden by the
  contract #968 closed under.
- `landing_page_snapshot` row count >0 and growing daily — not measured
  from the canary; needs a D1 probe.
- A share link that renders logged out — passes now.

The §3.4 watched-competitor clause needs a real ≥14-day watch on a real
competitor before the canary can PASS it. The earliest honest pass for a
brand first watched on 2026-08-25 (the demo backfill date) is
2026-09-08.

## Unit tests for the detector

```
npx vitest run --configLoader runner --project node tests/bet3-live-verification.test.ts
```

Result: **26 passed (26)** — parser, termination checks (including the
14-day span and screenshot-link requirement), rate limiter, package.json
lock, and the rule that a D1 SKIP is not a pass.
