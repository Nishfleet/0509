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

Live headers seen from European edges (same check, `curl -D -`):

| URL | `cf-ray` edge | `cf-placement` |
| --- | --- | --- |
| `https://0509.io/` | `-HAM` | `local-` |
| `https://0509.io/ads/adidas.com` | `-FRA` | `remote-NRT` |

So a D1-touching route (for example `/ads/*`) is executed **in Tokyo (NRT)**
even when the visitor's edge is in Europe, because Smart Placement parks compute
next to the APAC-primary database. Routes that do not reach D1 still run at the
edge (`local-`).

These two facts together — APAC primary, Smart Placement on — are the whole
reason `cf-placement: remote-NRT` appears on public HTML. Any cache hit served
at the edge never reaches the Worker, so it does not pay the APAC round trip.

## Decision boundary (binding)

**Do not change placement, primary location, or replication.** The primary is
outside EU/US, so this file records it and stops. Moving the primary, enabling
D1 read replication, or switching placement mode is an owner decision, not an
agent one. Open a separate ticket with the tradeoff written out if that is
wanted.

## How to re-check

```bash
# token lives outside the repo; never commit or print it
set -a && . ~/.config/cloudflare/deploy.env && set +a
npx wrangler d1 info 0509            # human table
npx wrangler d1 info 0509 --json     # machine-readable
curl -sS -o /dev/null -D - --max-time 25 https://0509.io/ads/adidas.com | grep -i cf-placement
```

Re-check date so far: **2026-09-10**.
