# claim/issue-3247 — visitor: home_edge=NONE and home TTFB 319ms -> 1004ms (regression vs 08:40Z HIT)

Issue: Nishfleet/0509#3247 — find why https://0509.io/ lost the Cloudflare edge
HIT between the 08:40Z judge (`home_edge=HIT home_ttfb_ms=319`) and the 09:01Z
judge (`home_edge=NONE home_ttfb_ms=1004`); metric: `home_edge`, `home_ttfb_ms`.

## What broke (root-cause trail)

- No commit changed the home route's cache headers. #3260 (merged 2026-09-12,
  `7f76a312d`) added a bounded serve-stale window, but the staleness check sits
  AFTER `cache.match` — and `cache.match` itself enforces the STORED copy's
  `cache-control` (Cloudflare Cache API: "missing or expired"). Copies stored
  at `max-age=300` were gone from the Cache API at 300s, so the 1800s window
  could never observe anything. #3260 merged, the issue auto-closed, was
  reopened because the termination (a quoted `visitor:` line with
  `home_edge=HIT`) was still unmet.
- Live proof of the ceiling (colo HAM, 2026-09-12, recorded on the issue):
  `/?edgeprobe=3247exp` warmed -> worker-internal HIT at ~20s; the same key
  MISSes at ~390s with home TTFB 2.87s. Stored `max-age=300` was the hard
  matchability limit.

## The fix (merged: #3282, 2026-09-12T13:46Z)

- `ab810164b` — the window moves INTO the stored copy's own lifetime:
  stored copies now carry `public, max-age=<ttl + EDGE_STALE_WINDOW_SECONDS>`
  (the matchable bound) plus an `x-0509-edge-ttl` stamp; every SERVED reply
  (MISS and HIT) still restores exactly `public, max-age=<ttl>`, so the
  `check-live-public-home` deploy-gate contract (`public, max-age=300`) is
  untouched. A stale serve returns instantly and queues one `ctx.waitUntil`
  background render+store, so probe-only traffic refreshes the copy it just
  served.
- `ed41bb773` (review round): stamped ttl clamped to `EDGE_TTL_CAP_SECONDS`;
  `expires`/`age` stripped from the stored copy (`cache.put` honours
  `Expires` — a stray one re-breaks matchability, the exact #3247 shape);
  stale-HEAD-queues-refresh wiring test. `3d15bd77c`: test file split under
  the file-size ratchet.
- Deploy invalidation untouched: the version id stays in the edge key, so a
  stale serve never crosses a deploy.

## Residual, then closed

After #3282 the zone's respect-origin Edge TTL was still 300s, so warmth
between the judge's 20-30-min probes stayed a coin flip. #3308's lane fixed
that: #3327 (merged 2026-09-13T00:31Z) adds `s-maxage=3900`
(300 + EDGE_STALE_WINDOW_SECONDS) plus a zone-HIT assertion in
`check-live-public-home`, so the next regression fails the deploy instead of
waiting for the judge. That is #3308's lane; recorded here because it is why
the HIT now persists between probes.

## Final-run receipts (2026-09-13, this box)

- Judge probe, `bash /home/nish/workspaces/agent-state/fleet-landing-watch/measure.sh`:

  ```
  visitor: https_redirect=301 home_ttfb_ms=80 home_edge=HIT search_ttfb_ms=1163 manifest=200 dup_routes=0 public_repo_leaks=0
  deploy: last_success_age_h=83 merges_since=427 last_failure=failure@34736169021 live_edge_cache=HIT
  ```

  `home_edge=HIT` with `home_ttfb_ms=80`: inside 3x of the 319ms prior-HIT bar
  and under the 09:26Z note's ~1500ms. This is the issue's required clause and
  its accept/termination quote; the same line is quoted on the issue.
- Anonymous production GET (2026-09-13T~05:22Z): `cf-cache-status: HIT,
  age: 140`, `cache-control: public, max-age=14400` (accepted zone-rewrite
  shape 1), `x-0509-edge-cache: HIT`, `x-0509-edge-stored-at: 1789276765`
  (= 2026-09-13T05:19:25Z; ~155s old at the GET — a fresh store served from
  the edge, both layers warm). The >300s survival case (the ab810164b fix's
  own proof) is the 23:22Z/23:37Z receipts on the issue and #3327's final-run
  section; production demonstrably runs the #3282 stamps this hour.
- The fix is on main: `git merge-base --is-ancestor ab810164b origin/main` ->
  exit 0. This PR's only delta is this report — no code, no tests touched;
  the node suite runs in PR CI (CI owns coverage and typecheck).
