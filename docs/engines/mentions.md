# Engine 5 — Mentions

This engine landed in **#4692 (merged 2026-09-24)**. The pre-#4692 contracts called for a **Cron Trigger** producer feeding a rate-classed **Cloudflare Queue** pair (one concurrency-10 lane for sub-second sources and one concurrency-1 lane for the 18-second-429 sources) into a separate downstream Workflow, with Google News RSS as the headline source, DuckDuckGo and Reddit in the MVP set, and a cross-source D8 judgment doing the dedup. **None of that is what shipped.** What shipped is a single scheduled Workflow with one retried step per `(plugin, target_key)` pair, GDELT replacing Google News, dedup-by-dedup_key on the `signal` table rather than by D8, and zero queues and zero direct cron triggers anywhere in this engine.

The original Opus-deputy reasoning — the live probes, the design-it-twice fork, the cost arithmetic, the failure-mode table — is preserved below at the bottom of this file under `Historical design (pre-#4692)` so the design history is not lost. Do not implement anything below that heading; it documents what was rejected or replaced. Every path named in the `As built` section above exists on `main` today and is verified with `git ls-files`; the `Historical design` section names no code paths, only the design that never shipped.

---

## As built (2026-09-24, after #4692)

### Live sources

- **GDELT DOC 2.0** (`gdelt.doc`), `official_api` reliability. The Google News RSS feed was the pre-#4692 source; its `<copyright>` element limits use to *"personal, non-commercial use"*, which a paid product is not, so the consumer switched to GDELT and HN Algolia. The Google News RSS adapter (`workers/sources/mentions/google-news.ts`) is registered and tested but has no enabled `source` row; it is being removed in **#5067**. The unresolved-link finding recorded by the original probe under `Historical design → §0.1` is preserved as the record of why the design dropped Browser-Run flattening.
- **Hacker News Algolia** (`hn.algolia`), `official_api` reliability. The HN `objectID` is the dedup key (`workers/sources/mentions/hn.ts`).
- **YouTube** (`youtube.channel_rss`) and **Medium** (`medium.tag_rss`) adapters are registered in `workers/sources/registry.ts` and tested (`tests/mentions/youtube.test.ts`, `tests/mentions/medium.test.ts`). No `source` row carries these `plugin_key`s yet; the eligibility join (`source.is_enabled = 1`) hides them.

The migration that introduces the two enabled `source` rows is a numbered file under `migrations/` (do not restate the number; `wrangler d1 migrations list` is the authority).

### The runner: the scheduled Workflow `mentions-sweep`

The runner is the **Workflow** `mentions-sweep` (`workers/workflows/mentions.ts`), bound to `wrangler.jsonc` as the binding `MENTIONS`. Its `schedules: ["0 1 * * *"]` fires once a night at **01:00 UTC**, off-the-hour from the 02:00 site sweep and the 03:00 standing refresh. The schedule list in `wrangler.jsonc` carries `"*/5 * * * *"`, `"0 3 * * *"`, `"0 4 * * 1"` — the mentions sweep is **not** on that list, it is a Workflow schedule, and there are **no queues** for mentions anywhere in this codebase.

`wrangler.jsonc` names the class `MentionsWorkflow`, which `workers/app.ts` exports as an instrumented wrapper around `MentionsSweep` from `workers/workflows/mentions.ts`. It runs one `step.do` per `(plugin_key, target_key)` pair (one target per source per brand), each with `retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }`. The pacing constant is `PACED_PLUGINS = { "gdelt.doc" }`; between two GDELT targets it `step.sleep("6 seconds")` to honour GDELT's one-request-per-five-seconds ceiling. Non-GDELT adapters are not paced.

A target that throws is logged as `mentions.target_failed` and counted as `failed` in the final `mentions.sweep` outcome line; the rest of the targets continue.

### Per watch, per tick

`workers/mentions/sweep.ts` defines:

- `planTargets()` reads `app/lib/data/watch.server.ts` `readActiveWatches("mentions")` and groups them by `(source_id, target_key)`, returning one `MentionTarget` per `(plugin, target_key)`.
- `sweepTarget(target, now)`:
  1. Looks up the adapter (`adapterFor(pluginKey)` from `workers/sources/registry.ts`); throws if missing.
  2. Calls the adapter once with `AbortSignal.timeout(8000)` (`workers/sources/mentions/types.ts` `fetchUpstream`).
  3. Filters items to those with non-empty titles.
  4. Computes `hash = sha256(rawBody)`.
  5. Writes the body to **R2** at `snapshot/mentions/<plugin_key>/<hash>` via `env.SNAPSHOTS.put` (unconditional; a re-poll with an unchanged body re-PUTs the same key).
  6. For each watch on this target, reads `readDiscoveryContext(workspace_id)` once per workspace and calls `statementsForWatch(...)`.
- `statementsForWatch(...)`:
  - Inserts exactly one `snapshot` row per watch per tick (`app/lib/data/snapshot.server.ts` `insertWatchSnapshot`).
  - Reads `readSeenDedupKeys(source_id, dedup_keys)` against `signal(source_id, dedup_key)` and drops known keys from the batch.
  - Caps the batch at **12** fresh items per watch per tick (`JUDGED_PER_WATCH = 12`).
  - For each fresh item calls `judge(...)` which runs Jev (below), then stages `signal`, `jev_verdict` and optionally `alert` statements.
  - Calls `markWatchPolled(watch_id, now)` after the D1 `batch()` lands.

### Judgment: D5 then D6

For each fresh item the sweep calls Jev via `app/lib/jev/client.server.ts` `askNoul`:

- **D5** `mention_is_about_brand`. Threshold via `app/lib/jev/thresholds.ts` `noulAction(p)`: `act` at `p >= 0.9`, `reject` at `p <= 0.1`, otherwise `maybe`. A `reject` verdict is recorded on `jev_verdict` (UNIQUE on `(question_id, input_hash)`), and the `signal` row is written with `is_tombstoned = 1`. `readSeenDedupKeys` does **not** filter on `is_tombstoned`, so a one-time reject is never re-judged. Every read path filters `is_tombstoned = 0`.
- **D6** `mention_matters` — only on a D5 keep. `act` writes an `alert` row via `app/lib/data/alert.server.ts` `insertSignalAlert`, `kind = 'mention'`, `title = "<watch.name>: <item.title>"`. The feed that renders these alerts sits elsewhere (engine 6, standing) and is not this engine's responsibility.

A `JevUnavailableError` thrown by `askNoul` aborts the rest of the watch's batch: no further items are judged, **nothing is stored**, and the loop sets `unjudged = fresh.length - index`. The next night's Workflow instance sees the same fresh items again (`readSeenDedupKeys` found nothing, so they are still in `fresh`) and retries them.

**No D8 runs.** Dedup is `(source_id, dedup_key)` on `signal` and `ON CONFLICT DO NOTHING` — string-equal in the DB, no judgment involved. The `dedup_key` stored is `"<entity_id>:<adapter dedupKey>"`, so one story is judged once per brand per source, and the UNIQUE constraint is what stops a second insert, not a verdict. The cross-source fan-in that the pre-#4692 design sketched is **not shipped**.

### Files in this engine

Code paths that exist on `main` today (verified with `git ls-files <path>`):

```
workers/mentions/sweep.ts                          # planTargets / sweepTarget / statementsForWatch / judge
workers/mentions/map.ts                            # toSignalRow: adapter item -> signal row (contract + tests)
workers/workflows/mentions.ts                      # MentionsSweep Workflow class (one step per target)
workers/app.ts                                     # exports the Workflow class bound to wrangler.jsonc MENTIONS
workers/sources/registry.ts                        # adapter dispatch by plugin_key
workers/sources/mentions/types.ts                  # mentionsResultSchema, fetchUpstream (8 s AbortSignal)
workers/sources/mentions/feed.ts                   # @extractus/feed-extractor wrapper used by google-news / youtube
workers/sources/mentions/gdelt.ts                  # gdelt.doc adapter
workers/sources/mentions/hn.ts                     # hn.algolia adapter
workers/sources/mentions/google-news.ts            # being removed in #5067
workers/sources/mentions/youtube.ts                # registered, no enabled source row
workers/sources/mentions/medium.ts                 # registered, no enabled source row
app/lib/coverage.ts                                # live source pill renderer shown on the landing page
app/lib/jev/client.server.ts                       # askNoul, JevUnavailableError
app/lib/jev/thresholds.ts                          # noulAction(p): act / maybe / reject
app/lib/data/watch.server.ts                       # readActiveWatches, markWatchPolled
app/lib/data/snapshot.server.ts                    # insertWatchSnapshot
app/lib/data/signal.server.ts                      # insertMention + readSeenDedupKeys
app/lib/data/jev_verdict.server.ts                 # insertVerdict (UNIQUE on question_id + input_hash)
app/lib/data/alert.server.ts                       # insertSignalAlert
app/lib/data/entity.server.ts                      # readDiscoveryContext (subject + competitor set)
app/lib/standing-score.ts                          # D3 / D6 question ids, bucket taxonomy
wrangler.jsonc                                     # workflows.mentions-sweep (schedules, binding) and schedule list
docs/REBUILD-STACK.md                              # the Jev/Workers/R2 stack this engine consumes
docs/REBUILD-SCHEMA.md                             # signal table CHECK constraint and dedup UNIQUE on (source_id, dedup_key)
docs/REBUILD-JEV.md                                # D5 / D6 question definitions
docs/REBUILD-COST.md                               # the cost model whose zero-Jev-browser this engine depends on
tests/mentions/contract.test.ts                    # adapter contract: canaryCount, items.title, rawBody
tests/mentions/gdelt.test.ts                       # gdelt.doc adapter
tests/mentions/hn.test.ts                          # hn.algolia adapter
tests/mentions/google-news.test.ts                 # google-news RSS adapter (being removed)
tests/mentions/youtube.test.ts                     # youtube.channel_rss adapter
tests/mentions/medium.test.ts                      # medium.tag_rss adapter
tests/mentions/feed-extra.test.ts                  # the @extractus/feed-extractor wrapper
tests/mentions/map.test.ts                         # MentionItem shape
tests/integration/mentions/sweep.integration.test.ts               # planTargets, dedup, Jev-unavailable retry path
tests/integration/mentions/x-disabled-source.integration.test.ts   # disabled x.* is not polled
```

### Cost line

Per 1,000 polls (one source × one watch × one tick):

| Resource | Units | Cloudflare cost |
|---|---|---|
| Workers requests | 1,000 | included |
| D1 rows written (`snapshot`) | 1,000 | included |
| D1 rows written (`signal`) | up to ~12 × fraction surviving D5 | included |
| D1 rows written (`alert` on D6 act) | up to ~12 × fraction with `p >= 0.9` | included |
| R2 Class A (PUT body) | 1,000 | included |
| R2 storage (~50 KB / body, one-year snapshot/ rule) | ~50 MB | included |
| Workflow steps | 1 plan step + 1 step per target | included |
| Browser Rendering | **0** | **$0** |
| Jev | 1 D5 + 0–1 D6 per fresh item, capped 12 / watch | seat cost |

Monthly at 100 brands × 2 live sources × 1 tick × 30 days = **6,000 polls/month**. All inside included tiers, **$0.00 Cloudflare**. Jev is the only real cost.

### Failure modes

- **Jev unavailable** — `JevUnavailableError` aborts the rest of the watch; **nothing is stored**. The next night's instance retries the same fresh items. Proven by `tests/integration/mentions/sweep.integration.test.ts` "stores nothing unjudged when the AI is unavailable".
- **Adapter throw** — `sweepTarget`'s caller catches, logs `mentions.target_failed`, counts the target as failed and moves on. Other targets are not blocked.
- **Same item twice** — `(source_id, dedup_key)` is `UNIQUE` on `signal`; `insertMention` uses `ON CONFLICT DO NOTHING`. Proven by the "does not judge or alert the same article twice" integration test.
- **D5 reject** — stored with `is_tombstoned = 1`; never judged again (no tombstone filter in `readSeenDedupKeys`); hidden from every read path that filters `is_tombstoned = 0`.
- **R2 PUT on unchanged body** — we re-PUT the body at the same key; R2 is idempotent on `PUT`, no extra storage cost, and the `snapshot` row is still written so coverage/freshness is answerable.
- **GDELT 429 / pacing** — pacing `step.sleep("6 seconds")` between GDELT targets; `step.do` retries twice on transient throws.

---

## Historical design (pre-#4692)

### 0.1 Google News links cannot be resolved server-side. The contract's stated method does not work.

`docs/REBUILD-MENTIONS.md` §3 says: *"That is a `fetch(link, { redirect: "manual" })` and reading `Location` — one extra request per new item."* It is not. Four probes:

| Probe | Result |
|---|---|
| `GET <rss article link>`, no follow | **302 → `https://consent.google.com/m?continue=…&gl=DE&…`** |
| same, with `Cookie: CONSENT=YES+cb.20220301-11-p0.en+FX+111` | **302 → consent.google.com**, unchanged |
| same, `&ucbcb=1` appended | **302 → back to `news.google.com/rss/articles/…`** — consent cleared, still no article |
| `curl -sL --max-redirs 8 "<link>&ucbcb=1"` | **200, 582,999 B**, final URL still `news.google.com/rss/articles/…` |

That 583 KB terminal document is an **Angular application shell**. `data-n-au` **absent**, `http-equiv="refresh"` **absent**, the publisher string `advertisinglaw` / `fkks` **absent**. There is no `Location` and no article URL in the markup; the hop is performed by JavaScript.

Decoding the `guid` directly gives 256 base64 characters decoding to 192 bytes of protobuf whose payload begins `AU_yqLPAkOm91GfyXe1hrE7aItGey8I8bm3FFklWhnWRD9u2…` — the post-2024 opaque format, an encrypted id, **not a URL**.

**Consequence, and why Google News is gone from the shipped engine:** a Worker cannot obtain a Google News item's real article URL without either running a browser or reverse-engineering Google's `batchexecute` endpoint. The second is forbidden (no glue); the first costs browser-seconds this engine is designed not to spend. Combined with the feed's `<copyright>` limiting use to personal, non-commercial use, the source was dropped rather than resolved. The adapter that remains on `main` is being removed in **#5067**.

The original Opus-deputy design it-twice screening, the 2026-09-21 probe table, the cross-source D8 dedup plan, the rate-classed two-queue producer-consumer layout it called for, and the Browser-Run fork for resolving Google News links are preserved here as plain Markdown so the design history is not lost. **The text below documents what was rejected or replaced; none of it is the current design.** No path in the lines below is code; the *only* paths named in the current design are listed above under `Files in this engine`.

The pre-#4692 design proposed a producer triggered at `17 2 * * *` (off-the-hour from the other engines' schedules) that enqueued one message per eligible watch onto two rate-classed Queues: one concurrency-10 lane for the sub-second sources and one concurrency-1 lane for the rate-limited / headless sources (Reddit was assumed in the set, with an 18-second 429 measured on the second request). Each consumer was meant to write one `snapshot` row per watch per tick with the body in R2, and a downstream `MentionsJudgeWorkflow` was meant to consume those snapshots and run **D5 → D8 → D6** in that order. D8 (`duplicate_signal`) was supposed to be the cross-source fan-in, replacing the string-equal `url_hash` matching that the schema's `UNIQUE (source_id, dedup_key)` actually ships with. The MVP source set under that design was five sources (Google News, Reddit, HN Algolia, YouTube, Medium) plus DuckDuckGo as a disabled row; the runner it justified relied on the Queue concurrency cap to do the rate limiting and required a Browser Run pass to flatten Google News's 583 KB Angular shell hop. The probes recorded three load-bearing findings that drove the rewrite: Google News links cannot be resolved server-side (no `Location` header, encrypted `guid`, no Angular markup), DuckDuckGo 202-challenges every request from a shared datacenter IP after a handful of probes, and Hacker News's first result for `"gymshark"` on 2026-09-21 was a `GameShark` retro-console cheat code story. The cost arithmetic of the original layout is also preserved in the prior edit of this file; the headline was **5.0 browser-hours/month at 100 brands** for zero new signal — which is what caused the runner to drop the Browser Run and the Google News source.

After #4692 merged, every claim in the original "Failure modes and the degraded UI state" section that referred to per-source canaries was set aside: the canary field on the adapter result (`canaryCount`) is asserted by `tests/mentions/contract.test.ts` but is **not** consumed by the sweep, the read path, or the UI. A degraded-state pill, a per-source Analytics Engine series, and a homepage freshness line were all part of the pre-#4692 design and none of them are shipped. The source-disabled discipline from the pre-#4692 design — disabled rows produce zero Workflow messages, zero `snapshot` rows and zero UI surface, so enabling a source is one `UPDATE` — is the one piece that survived and is asserted by `tests/integration/mentions/x-disabled-source.integration.test.ts`.
