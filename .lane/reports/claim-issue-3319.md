# Lane evidence — claim/issue-3319 (Nishfleet/0509#3319)

## Task

`/search` TTFB intermittently 6-7s: bimodal ~1s vs ~6-7s on identical reads,
same colo — origin-side, not edge/network. 10 spaced reads of
`/search?q=calendly.com` in the issue (2026-09-12) showed fast 966-1264ms
(4/10) vs slow 5124-7136ms (6/10), `ttfb ≈ total`, colo HAM on every read,
no `cf-cache-status` — the wait was the origin producing the first byte.
Required: characterize the tail over one spaced series (10+ reads, 60s
apart) and identify which origin path adds the extra ~5s, with proof — not
just correlation.

## Finding: the extra ~5s is the locally-placed isolate's awaited serial
round-trips — placement-proven, not correlated

Two spaced series were recorded against the issue's exact probe
(`/search?q=calendly.com`, production, pre-fix), banked in this branch:

- `.fleet/probe-3319-results.jsonl` — 12 reads 60s apart, 21:07-21:19Z:
  fast (TTFB < 2s) 4/12; slow reads 5.9-7.6s, every one 200, same colo.
- `.fleet/probe-3319b-results.jsonl` — 18 reads (3s-bursts + 12 spaced
  60s + 3s-bursts), 01:27-01:42Z, with per-read discrimination:
  `cf-placement: remote-NRT` on EVERY fast read (1.1-1.3s) and
  `local-` on EVERY slow read (5.3-7.6s); one slow read additionally
  rendered the stale-background branch (`stale_bg`, 7.55s). Both burst
  phases were all-slow — the flip is not time-of-day, it is which isolate
  the edge handed the request (Smart Placement engaged vs local).

Mechanism (matches both series; the placed isolate runs the same code in
~1.0-1.3s, so the delta is round-trips times isolate↔D1 distance):

1. The anonymous "who advertises against you" preview ran
   `runSeedProbes` — keywords × countries — as strictly sequential
   discovery_cache_entry reads: one inter-region round-trip PER probe on
   the `/search` TTFB path.
2. Every discovery-cache serve awaited the browser-job telemetry D1 write
   through its bounded race: one more round-trip per serve.
3. The keyword tier-labelling identity resolution (2.5s-capped DoH +
   redirect-alias chain) started only after the search returned, serially
   behind everything else — and a fresh resolution per caller (no
   cross-caller dedup) could pay the chain twice on one request.

## What shipped (this PR)

- `app/lib/auto-competitor-seed.server.ts` — seed-probe reads execute in
  bounded waves of 8; same reads, same keys, same hit order.
- `app/lib/browser-job-telemetry.server.ts` — with a request
  ExecutionContext the telemetry write registers with `waitUntil` and the
  call returns immediately; the context owns delivery. Without a context
  the previous bounded race remains.
- `app/lib/website-identity.server.ts` — one in-flight resolution per
  registrable domain (`identityInFlight`); `prewarmWebsiteIdentity` for
  the loader to fire the SAME resolution early.
- `app/routes/search.tsx` — the loader pre-warms the identity before the
  rate-limit/funnel/lookup/preview awaits so the 2.5s-capped chain
  overlaps that work instead of serialising behind it; both later
  consumers (`attachKeywordSearchDomainMatch` for `q=` searches,
  `buildSearchV2Context` for `website=` searches) join the one in-flight
  task. A non-domain keyword resolves to null with no fetch.
- Tests: `tests/website-identity.server.test.ts` — two concurrent
  resolutions share ONE fetch chain; a prewarmed keyword joins the later
  resolution; non-domain prewarm costs nothing.
  `tests/browser-job-telemetry.test.ts` — the waitUntil-registered call
  returns without the bounded race; the registered promise still lands the
  row.

No hand redeploy; no cache/config change outside this PR; the search
rate-limit and cache-correctness guards are untouched.

## Verification (2026-09-13, this worktree)

- `npx vitest run --configLoader runner --project node
  tests/website-identity.server.test.ts tests/browser-job-telemetry.test.ts`
  → 2 files / 48 tests passed (includes the 3 new).
- `npx vitest run --configLoader runner --project node --changed
  origin/main` → 374 files / 4,809 tests passed.
- `sgscan` → "No new security findings." (exit 0)

## Loose ends

The issue's acceptance — visitor-visible `/search` TTFB under ~2000ms on at
least 9 of 10 spaced reads of the same probe — is deploy-gated (no hand
redeploy, per the issue). It needs one post-merge 10-read spaced series of
`/search?q=calendly.com` to observe-to-close. Fast (remote-placed) reads
already met it pre-fix (all 10 fast reads in the two series were
1.0-1.3s); the three mechanisms above remove/absorb the serial chains the
slow (locally-placed) reads paid.
