# Runtime region: where the D1 primary lives and where the Worker runs

Recorded so the next performance lens does not re-derive it. Read-only facts
plus the decision boundary; this file grants no permission to change anything.

## Facts (checked 2026-09-10, UTC)

`npx wrangler d1 info 0509` (run from the repo root):

```
┌───────────────────────┬──────────────────────────────────────┐
│ DB                    │ 746c6e3d-782e-443a-82d6-28ca93a16294 │
│ name                  │ 0509                                 │
│ created_at            │ 2026-04-06T08:15:16.620Z             │
│ num_tables            │ 96                                   │
│ running_in_region     │ APAC                                 │
│ jurisdiction          │ null                                 │
│ database_size         │ 49.6 MB                              │
│ read_queries_24h      │ 23,402                               │
│ write_queries_24h     │ 11,115                               │
│ rows_read_24h         │ 9,842,316                            │
│ rows_written_24h      │ 58,711                               │
│ read_replication.mode │ disabled                             │
└───────────────────────┴──────────────────────────────────────┘
```

The D1 primary is in the Cloudflare **APAC** region. Read replication is
**disabled**. `wrangler.jsonc` sets `"placement": { "mode": "smart" }`.

Live headers, captured from European edges with
`curl -sS -o /dev/null -D - --max-time 25` (same check):

```
$ curl -sS -o /dev/null -D - --max-time 25 https://0509.io/ads/adidas.com
HTTP/2 200
cf-placement: remote-NRT
cf-ray: a3918b62a9ccb71e-FRA

$ curl -sS -o /dev/null -D - --max-time 25 https://0509.io/
HTTP/2 200
cf-placement: local-
cf-ray: a3918b47a9c0b1e5-HAM
```

What those two captures show: the `/ads/adidas.com` response was executed **in
Tokyo (NRT)** while its visitor's edge was in Europe, and the `/` response was
not (`local-`). They are two captured URLs, not a rule about every route.

Inferred, not proven here: Smart Placement parks compute next to the backend a
Worker talks to, so the APAC-primary database is what pulls these requests to
NRT. The correlation between the two facts above is the inference; the facts
are the two blocks of output.

Any cache hit served at the edge never reaches the Worker, so it does not pay
the APAC round trip.

## Decision boundary (binding)

**Do not change placement, primary location, or replication.** The primary is
outside EU/US, so this file records it and stops. Moving the primary, enabling
D1 read replication, or switching placement mode is an owner decision, not an
agent one. Open a separate ticket with the tradeoff written out if that is
wanted.

## How to re-check

```bash
# A Cloudflare token must already be in the environment; the repo's own scripts
# read CLOUDFLARE_API_TOKEN (see scripts/d1-backup-lifecycle-canary.mjs,
# scripts/verify-post-deploy-release.mjs) and CLOUDFLARE_ACCOUNT_ID. This file
# does not say where to get them, and they are never committed or printed.
npx wrangler d1 info 0509            # human table
npx wrangler d1 info 0509 --json     # machine-readable
curl -sS -o /dev/null -D - --max-time 25 https://0509.io/ads/adidas.com | grep -i cf-placement
```

Re-check date so far: **2026-09-10**.
