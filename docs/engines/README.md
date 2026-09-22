# Engine designs — P3

One file per engine, in the P3 build order (umbrella #3842):

| Order | Engine | Issue | File |
|---|---|---|---|
| 1 | Identity card | #3885 | [`identity-card.md`](identity-card.md) |
| 2 | Competitor discovery | #3884 | [`competitor-discovery.md`](competitor-discovery.md) |
| 3 | Ads, Meta first | #3891 | [`ads.md`](ads.md) |
| 4 | Site-change tracking incl. own site | #3879 | [`site-change.md`](site-change.md) |

Each carries two candidate shapes with the screening and the pick, the data flow against `docs/REBUILD-SCHEMA.md` tables by name, the Workflow/Queue/cron layout with concurrency numbers, the exact upstream calls with live probes on Gymshark, the Jev decision ids and their context-pack fields, the cost line, the failure modes with their degraded UI states, and worker packets sized for 45 minutes with no design choice left.

## What the four share

These decisions are made once here and repeated in each file so a packet is readable alone.

**Two queues, and the browser cap is one number.**

```jsonc
"vars": { "BROWSER_CONCURRENCY_CAP": "10" },
"queues": { "consumers": [
  { "queue": "page-sweep",  "max_concurrency": 8,  "max_retries": 3, "dead_letter_queue": "page-sweep-dlq" },
  { "queue": "fetch-sweep", "max_concurrency": 20, "max_retries": 3, "dead_letter_queue": "fetch-sweep-dlq" }
]}
```

Everything that needs a browser goes through `page-sweep`; nothing else may open one. Two of the ten browsers are reserved for interactive onboarding so a customer's first screen never queues behind a sweep, and a test asserts `8 + 2 === BROWSER_CONCURRENCY_CAP`. Raising the cap costs $2.00 per additional concurrent browser per month and needs Nish's recorded yes (`REBUILD-COST.md`; his standing rule, 2026-09-21).

**Cron → Workflow → Queue, never work inline in `scheduled()`.** Each engine's Workflow runs the same five steps: `select` → `enqueue` (`sendBatch`) → `sleep` → `assert coverage` → `escalate`. The `assert` step counts `snapshot` rows for the tick, because `REBUILD-KEEPLIST.md` finding 3 is that a health check watching the cron heartbeat reported `ok` while one run covered 22 watchlists, and finding 2 is a source that reported active and captured nothing for 8 days. Coverage is asserted on outcomes.

**The Jev wire contract, probed live 2026-09-21 12:18:48Z and 12:19:10Z:**

```json
POST /jev
{"state": { …the context pack… },
 "questions": {"<id>": {"type": "boolean" | "choice" | "score",
                        "instructions": "…",
                        "criteria": {"option": "description", …}   // choice only
                       }, …}}
→ {"answers": {"<id>": {"type":"boolean","probability":0.9}},
   "usage": {"inputTokens":380,"outputTokens":23},
   "providerMetadata": {"typesafe": {"confidence": {…}},
                        "gateway": {"cost":"0","marketCost":"0.00001596"}}}
```

Several questions per request is supported, which is what makes the onboarding contract's batched field check real. A call measured 380 input / 23 output tokens, 0.33–0.78 s, **$0 on the system seat**.

## Stack corrections these designs make

| Named in the issue or brief | What these designs use | Why |
|---|---|---|
| `pixelmatch` 7.2.0 as the site diff (#3879) | **`diff` 9.0.0 over extracted text**; screenshots are evidence only | measured: two fetches of the same unchanged page differ in raw bytes (A/B variant tokens) while the extracted text is identical — a pixel diff inherits that noise rendered |
| `html-to-text` 10.0.1 (#3879) | **`HTMLRewriter`** | `REBUILD-STACK.md` §5.1: 46.4 KB gzip for word-wrapping a diff does not want, versus a platform primitive at 0 bytes |
| "the SERP route" for alternatives (#3884) | **Google News RSS roundup harvest** | DuckDuckGo HTML answered **202** (challenge) and Reddit search **403** from our egress; a paid SERP provider is a money decision, not a design one |
| Order Meta → Google → the rest (#3891) | **Meta → Reddit → Google → TikTok → LinkedIn**, five platforms parked | Reddit's ad library is the only one that answered a plain datacenter fetch; Snap, X, Pinterest, Amazon and Apple have no reachable search surface at the obvious URLs today |
| `tldts` for domain normalisation (#3885) | same, at **7.4.13** — **a new row for `docs/REBUILD-STACK.md`** | not in the stack doc yet; the packet adds the row in its own PR |

## Open for Nish

1. **A Cloudflare API token with Browser Rendering: Edit.** Both tokens on the VPS verify active and return `401 Authentication error` on `/browser-rendering/*`, so no packet can prove the browser leg from CI or the VPS — only from the deployed Worker. Minting one makes every browser proof directly checkable.
2. **TikTok Research Ad Library API access.** `open.tiktokapis.com/v2/research/adlib/…` answered `401 access_token_invalid`, so the surface is live and only needs an approved application. Zero spend, and it turns TikTok from a browser scrape into an official API.
