# Lane evidence — claim/issue-3308 (visitor probe: home_edge HIT → NONE)

## What broke, with receipts

Judge visitor lines, 20 minutes apart, same probe:

- `2026-09-12T14:20Z: visitor: https_redirect=301 home_edge=HIT home_ttfb_ms=66 …`
- `2026-09-12T14:50Z: visitor: https_redirect=301 home_edge=NONE home_ttfb_ms=1096 …`

The anonymous homepage stopped being served warm from the edge between those
two probes; every fresh visitor paid ~1.1s instead of ~66ms, for up to the full
render.

## Root cause (this unit's investigation, receipts on file)

No commit is responsible. `git diff 4bf178e30..origin/main --name-only` (the
whole 14:20Z→16:45Z window: #3289, #3300, #3037/#3041, #3245, #3312, #3313)
touches no home-route cache header, no cookie emission on `/` — #3289 (the only
merge inside the 14:20→14:50 window) is the Bluesky presence connector. The
worker's own home emission never regressed: every fresh-render receipt in this
issue (16:28Z salvage capture and 17:10Z mine) shows
`cache-control: public, max-age=…` + `vary: cookie` + **no set-cookie**.

The failure is the two-layer cache under deploy churn:

1. **Deploys orphan the worker-internal cache keys.** The edge-cache cache key
   carries the deployed version id, so every deploy cold-starts it: the first
   post-deploy anonymous visitor is a guaranteed full render (~1.1s). #3289
   deployed at ~14:45Z; the 14:50Z probe was the first post-deploy sample.
2. **The zone's respect-origin Edge TTL is the same 300s as the browser bound**
   (zone config, outside this repo). The hourly judge probes every 20–30
   minutes, so the zone copy is almost always older than 300s at probe time —
   `home_edge` reads `cf-cache-status`, absent (= NONE) on a zone-cold answer.
   14:20Z was warm, 14:50Z was not: a coin flip the code can see, the gate
   didn't check (the #2950 proof used only the worker-internal stamp).

Receipt — 17:10Z, one second apart, the oscillation itself:
live receipts quoted in the PR body (`req1` = zone replay
`cf-cache-status: HIT, age: 262, cache-control: public, max-age=14400`
(4h Browser-Cache-TTL zone rewrite), `req2` = worker render
`x-0509-edge-cache: MISS, cache-control: public, max-age=300`, no
cf-cache-status). Zone warmth flips between two requests within a minute;
a 20–30-minute-cadence judge samples that weather blind.

## The fix (this PR)

- `workers/security-headers.ts` + `workers/edge-cache.ts`: the shared policy
  gains `s-maxage=3900` (the unchanged #2950 300s browser bound + the
  #3247-accepted 3600s serve-stale window). A respect-origin zone Edge TTL
  now outlives the judge cadence **and** the post-deploy cold window; browsers
  still expire at 300s. Authed responses stay uncached (cookie gate, stored
  copies carry no set-cookie).
- `scripts/check-live-public-home.mjs`: the second consecutive anonymous GET
  must be a **zone HIT** (`cf-cache-status`, read exactly like the judge's
  `home_edge`: uppercased, absent = NONE) beside the #2950 stamp — the
  `required:` assertion that fails a deploy instead of waiting for the judge.
- Same receipt run: the exact-string cache-control contract is flaky against
  the zone rewrite, so the accepted set holds the worker policy **and** the
  two observed zone rewrites (`public, max-age=14400`,
  `public, s-maxage=3900, max-age=14400`); coupling test pins the exact set.
- `tests/worker-security-headers.test.ts`, `tests/worker-edge-cache.test.ts`,
  `tests/worker-edge-cache-wiring.test.ts`, `tests/pricing.route.test.ts`:
  coupling updated so the gate, the policy and the values cannot drift apart.

## Not in scope / loose ends

- `deploy-ledger.jsonl`'s last row has `version_id: null` — no green deploy run
  in the ledger names WHICH worker version serves production (#2996/#3190 own
  the deploy-verify pipeline). Recorded, not fixed here.
- If the zone's Browser-Cache-TTL rule is reconfigured (4h default →
  different), the accepted set must gain the then-observed shape; the failing
  gate prints the response's actual `cacheControl` verbatim.
- The acceptance's `home_ttfb_ms < 200 in the next measure.sh visitor line`
  is judge-produced; this PR ships the mechanical gate so the next regression
  fails deploys, not the hourly judge.

## Verification receipts (final run, 2026-09-12T23:05Z, this unit)

Issue step 1 receipt (`curl -sSI https://0509.io/ | grep -iE "cf-cache-status|cache-control|set-cookie|age"`, two consecutive):

- 1st: MISS (no `cf-cache-status`), `cache-control: public, max-age=300` — the still-deployed pre-#3308 worker; no set-cookie.
- 2nd: `cf-cache-status: HIT`, `age: 0`, `cache-control: public, max-age=14400` — zone replay, TTL rewritten to the 4h zone Browser-Cache-TTL; no set-cookie.

Root-cause timing, corrected and pinned:

- main@14:20Z = `5c15ef4b2`; main@14:50Z = `4bf178e30` (= #3289's merge, commit dated 2026-09-12T14:45:20Z; GitHub `mergedAt` 14:55:41Z lags the merge commit — the deploy trigger fired inside that gap).
- `git diff 5c15ef4b2..4bf178e30 --name-only`: ONLY `app/lib/*` (RSS presence connector), `data/seed-lists/sneaker-resale.json`, tests, and a PR-notes file — **no** `workers/` file, so no commit changed the home route's cache headers or its Set-Cookie behaviour in the flap window. Independently verified here.
- Live receipts (both above + every fresh render) show the worker's own emission unchanged: `public, max-age=…`, `vary: cookie`, no set-cookie. The regression is the two-layer cache under deploy churn + the 300s zone Edge TTL, as recorded above — not any commit in the window.

Judge-shaped probe, this box, 2026-09-12T23:00Z:

- `bin/fleet-visitor-probe` (read-only run): `visitor: https_redirect=301 home_ttfb_ms=2562 home_edge=NONE search_ttfb_ms=6431 manifest=200 dup_routes=0 public_repo_leaks=0` — the regressed shape, reproduced (zone cold).
- Acceptance clause 1 (`cf-cache-status: HIT` on a second consecutive anonymous request): satisfied repeatedly — curl ×3: HIT/HIT/HIT with warm steady-state TTFB **67ms** (first two 306/317ms carried fresh-TLS overhead); an undici pair: MISS 918ms → HIT **265ms**.
- Acceptance clause 2 (`home_ttfb_ms < 200 in the next measure.sh visitor line`): the 66ms-class warm-HIT steady state is exactly what this box reproduces (67ms); the judge's next post-deploy line closes it — the #3320 precedent (re-probe + record) applies.

Gates run on this branch:

- `npx vitest run --configLoader runner --project node --changed origin/main` → 10 files, 103 tests, pass (exit 0).
- The 4 touched test files explicitly (`worker-security-headers`, `worker-edge-cache`, `worker-edge-cache-wiring`, `pricing.route`) → 4 files, 64 tests, pass (exit 0).
- `sgscan --base origin/main` → "No new security findings." (exit 0).
- Local `crgate`: CodeRabbit CLI 0.7.6 present but not signed in on this machine (exit 0, printed notice) — noted, not a failure; the senior-seat reviewer round on the PR is the substantive review for this product repo.
- `node scripts/check-live-public-home.mjs` against TODAY's production → exit 1, and that is correct-by-design: the only failing assertion is the busted-URL MISS carrying the old worker's `public, max-age=300`, which the #3308 accepted set deliberately excludes (the set pins the NEW policy's shapes). The gate runs post-deploy (`deploy-production-plan.mjs` step `live_public_truth` after the `wrangler deploy` step), so it turns green exactly when this branch's worker ships: MISS = `public, s-maxage=3900, max-age=300` (accepted), zone HIT = one of the two accepted rewrites.
