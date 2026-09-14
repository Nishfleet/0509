# claim/issue-3522 — visitor probe: home_edge=NONE + home TTFB 82ms -> 3662ms

## Diagnosis (verified live 2026-09-14 ~17:52Z)

`home_edge` is `cf-cache-status` uppercased, NONE when the header is absent —
and on 0509.io a zone MISS emits no `cf-cache-status` at all (see
scripts/check-live-public-home.mjs #3308 notes). So NONE = "request reached
the worker", and 3662ms = the full cold render it then paid.

Root cause — synchronized expiry of the two cache layers:

- The served response carries `cache-control: public, s-maxage=3900,
  max-age=300` (issue #3308). The ZONE holds that response for 3900s.
- The WORKER's stored copy (named Cache API, `public-html-edge-v1`) was
  stored with `max-age = ttl + EDGE_STALE_WINDOW_SECONDS = 300 + 3600 =
  3900` — the SAME 3900s.
- Both are written at the same instant (the zone caches the response the
  worker just produced), so both expire at the same instant. Every ~65min
  boundary the first request is a guaranteed double-MISS cold render — the
  #3247 serve-stale machinery can never fire because the zone shields the
  worker for the entire window.

Timeline fit: judge saw HIT/82ms at 13:43Z and NONE/3662ms at 14:23Z — a
copy stored ~13:00-13:18Z expires both layers ~14:05-14:23Z. Recurring, not
a deploy regression: storage works end-to-end (live curls show MISS ->
fresh store -> cf-cache-status: HIT, age:21, 0.63s).

Live repro (curl https://0509.io/, 17:52Z): req1 `x-0509-edge-cache: MISS`,
no cf-cache-status, ttfb 1.43s; req2 MISS, new stored-at, ttfb 2.96s;
req3 `cf-cache-status: HIT`, `x-0509-edge-cache: HIT`, age 21, ttfb 0.63s.

## Fix

`EDGE_ZONE_REWARM_GRACE_SECONDS = 3600` (workers/edge-cache.ts): the stored
copy's matchable lifetime becomes ttl + window + grace = 7500s, strictly
longer than the zone's 3900s hold. A zone expiry now always lands on a
stale-but-serveable worker copy: it answers in ~ms, re-arms the zone for
the full 3900 (served contract untouched — still
`public, s-maxage=3900, max-age=300`, so #3308's deploy gate is unaffected),
and the waitUntil'd renderAndStore refreshes the copy underneath.

The match-side expiry check and the stored `cache-control` both move to
ttl + window + grace; `edgeCacheCopyIsStale` (age > ttl) is unchanged, so
the background re-render still fires on every stale serve.

Must-nots honored: probe untouched; auth/cookie'd requests never reach the
store (cookie gate unchanged); no forced cache headers on auth pages.

## Verification

- `npx vitest run --project node tests/worker-edge-cache.test.ts
  tests/worker-edge-cache-wiring.test.ts tests/worker-security-headers.test.ts
  tests/pricing.route.test.ts` -> 65 passed.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  -> 114 passed (11 files).
- Live edge probe (see Diagnosis): MISS/HIT/NONE shapes reproduced and
  explained by the synchronized-expiry model.
- Post-merge: judge visitor probe should read home_edge=HIT and
  home_ttfb_ms < ~500ms once the zone re-warms; the recurring ~65min
  double-MISS boundary is removed.

## Salvage note

Work resumed from banked commit d6deede55 (wip/pi-issue-0509-3522-
20260914T173144Z), cherry-picked onto origin/main f00dc5f2d. Prior unit's
diagnosis verified independently against the live edge before adoption.
