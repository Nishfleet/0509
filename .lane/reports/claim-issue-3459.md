# Lane evidence — claim/issue-3459

Issue: Nishfleet/0509#3459 — prove the 2026-09-11/12 "organic signups'" watchlist
actually ran (market signal showed 0 runs / 0 events / 0 digests at a 22.3h-stale
snapshot).

Outcome: observe-to-close (accept #2). No code change. Every watchlist created
since 2026-09-10 has >=1 watchlist_run, and digests are not merely scheduled —
two digest_runs already reached `delivery_status = 'sent'`.

## Prod D1 reads (read-only SELECTs, 2026-09-14 ~08:4x UTC)

Termination query, verbatim from the issue:

```
npx wrangler d1 execute DB --remote --json --command \
  "SELECT w.id, w.created_at, (SELECT COUNT(*) FROM watchlist_run r WHERE r.watchlist_id = w.id) AS runs FROM watchlist w WHERE w.created_at >= '2026-09-10' ORDER BY w.created_at DESC" \
  | jq -e '.[0].results | length > 0 and (map(.runs) | all(. > 0))'
=> true   (exit 0)
```

Result rows (ids + timestamps only, PII masked per the issue):

| watchlist id | created_at | runs |
|---|---|---|
| launch-readiness-canary-watchlist | 2026-09-11T17:56:36.312Z | 4 |

The whole `watchlist` table holds exactly 1 row (`watchlists_total = 1`,
`watchlists_since_0910 = 1`). The only watchlist in the signal's window is the
launch-readiness canary's own.

## Run history of that watchlist

| run id | created_at | trigger | status | finished_at |
|---|---|---|---|---|
| 6a2637c4-af0b-48b6-96bc-6ae5676fc95b | 2026-09-12T13:11:00.749Z | manual | running | null |
| ff0108a9-03c6-42c4-8089-4f2d0130a681 | 2026-09-13T17:33:46.016Z | manual | succeeded | 2026-09-13T17:33:57.700Z |
| cc19f878-d95c-4c91-934c-fc9e782c110b | 2026-09-14T00:58:44.484Z | manual | succeeded | 2026-09-14T00:58:56.444Z |
| c3faadf4-d781-4cf6-a43e-1d99a87296a4 | 2026-09-14T03:01:07.256Z | scheduled | succeeded | 2026-09-14T03:01:35.024Z |

At the market signal's snapshot (generated 2026-09-12T04:29Z, ~10.5h after
watchlist creation) the count really was 0 — the first run row appeared
2026-09-12T13:11Z. Since then: two succeeded manual runs and one succeeded
SCHEDULED run (2026-09-14T03:01Z) — the monitoring fan-out picks this watchlist
up in prod.

## Digest evidence (accept #4 — bar was "a pending delivery row")

Two `digest_run` rows for the canary owner, both delivered:

| digest_run id | period | created_at | delivery status | provider |
|---|---|---|---|---|
| 3b2c1a86-cc26-4ebf-a518-15cfa1f07c8c | 2026-09-13T16:33→17:33Z | 2026-09-13T17:33:57.855Z | sent | cloudflare_email |
| e604efd2-53b1-468a-883d-715c4de13c31 | 2026-09-13T23:58→09-14T00:58Z | 2026-09-14T00:58:56.458Z | sent | cloudflare_email |

## The premise correction (the real finding)

The signal's "2 new signups + 1 watchlist" were all fleet-synthetic rows, not
organic customers:

- `launch-readiness-canary-owner` (createdAt 2026-09-11T21:35:47.356Z — the
  "last signup" timestamp the issue quoted) — `CANARY_USER_ID` in
  `app/routes/api.launch-readiness.canary.ts`.
- `billing-canary-0509` (createdAt 2026-09-11T09:16:09.725Z) —
  `app/lib/billing-canary-identity.server.ts`.
- `launch-readiness-canary-watchlist` — `CANARY_WATCHLIST_ID`, same file.

`scripts/market-signal-snapshot.mjs` counts `users_7d` / `watchlists_7d` with no
synthetic-identity exclusion, so the canary trio read as "first movement in
days". Organic signups since 2026-09-08: 0. A third post-09-08 signup
(`Hs34vTj84aPr0H4ldO7R0UH3Cgd4mDJD`, 2026-09-14T08:38Z) is a `bet1-3322-*`
cohort-burst row (#3429) — also synthetic — proving the counter keeps absorbing
fleet-generated signups. Filed as Nishfleet/0509#3471 (signal-quality defect:
no synthetic-identity exclusion in the snapshot counts).

Live corroboration of the #3380 fix path: the bet1 burst runs signup → magic
link → watchlist creation through the product surface in prod *right now*, so
any watchlist it creates rides the exact queueing path this issue asked about.

## Accept-criteria accounting

1. Prod D1 read, every watchlist >= 2026-09-10 with run count: done above.
2. Every such watchlist has >=1 run (n=1, runs=4): observe-to-close, no code
   change.
3. Fix path not triggered: no >24h-old watchlist sits at 0 runs (first run row
   appeared ~19.3h after creation; 3 succeeded runs since, one of them
   scheduled).
4. First digest: delivered twice (`sent`), not merely pending.
5. Mechanism: the observation itself is the mechanism (observe-to-close); the
   pickup-test extension was conditioned on a defect that does not exist.
