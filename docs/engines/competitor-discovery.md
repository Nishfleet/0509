# Engine: competitor discovery

Issue #3884. Umbrella #3842. Author: the Opus architect, **2026-09-21**. Every probe below was run from this VPS today; times UTC.

The job: from one confirmed identity card, on a **cold database**, produce a real ranked competitor list inside the onboarding's 60-second budget — and keep it true over time.

---

## The two candidate shapes

### Candidate A — recall first, judge everything

Every generator runs, every candidate it produces is normalised to a domain, the set is deduplicated, and **every** candidate goes to Jev D1. Ranking is the returned probability.

- Maximum recall: a competitor named by one obscure source still gets a fair hearing.
- The verdict is Jev's for every row, with no code standing between the evidence and the judgment.
- At a measured 40–60 candidates per brand, that is 40–60 Jev calls per brand per discovery run, and the noise (publishers, marketplaces, the brand's own subsidiaries) is judged at full price alongside the signal.

### Candidate B — evidence-counted shortlist, bounded judgment

Generators emit candidates **with structured evidence**. Code then does only arithmetic — how many independent generators produced this domain, how many distinct documents co-mention it, does it resolve to a live site — and the top 20 by that count go to Jev D1. The rest are stored as `suggestion` rows with `status='unjudged'` and are judged on a later run if their evidence count grows.

- Bounded, predictable cost: 20 judgments per brand, whatever the internet does.
- The arithmetic is explicitly what code is allowed to do — `REBUILD-JEV.md` reserves "anything with a ground truth the code can read: counts" for code and keeps the verdict for Jev.
- A genuine competitor named by exactly one generator can sit unjudged for a week.

## Screening

**Both shapes give Jev the verdict. The fork is what reaches it.**

Candidate A's cost is real but small (60 calls at the measured $0.000016 is a hundredth of a cent). It is rejected for a different reason: **it makes the ranking a probability, and probabilities from a Noul are not a ranking.** The Jev contract is explicit — there is no rank primitive, and "ranking is composed from per-item Nouls and Scores in code". A list sorted by D1's `p` would put a confidently-judged tiny brand above a hedged large one, and would re-order itself every refresh as probabilities wobble at the second decimal.

Candidate B's ordering is a count of independent corroboration, which is stable, explainable in the UI in one line ("named in 4 roundups, advertises in the same category"), and exactly the kind of fact code is supposed to own.

**Where A is better:** recall, and only recall.

## Decision

**Candidate B wins**, on the ranking argument first and cost second.

**Grafted from A:**

1. **One guaranteed slot per generator.** The highest-evidence candidate unique to each generator is always judged, even at evidence count 1. That closes B's recall hole for about six extra calls per run and means no single source can be starved by a louder one.
2. **`unjudged` is a queue, not a graveyard.** Every refresh re-counts evidence for unjudged suggestions and promotes any that crossed the bar. A candidate that only gets mentioned twice in month three is judged in month three.
3. **The user's own input outranks all of it.** A user-added brand skips D1 entirely (`REBUILD-JEV.md`: "D1 never runs on a user-added brand") and enters at the top of the list.

**Rejected from A, recorded:** judging every candidate, and sorting the list by D1's probability. If recall ever proves to be the binding problem, the fix is another generator, not a bigger judgment budget.

---

## Live probes — one per generator, on Gymshark

| # | Generator | Call | Result |
|---|---|---|---|
| 1 | Google News RSS, roundup harvest | `news.google.com/rss/search?q=%22Gymshark%22%20alternatives` | **200**, 51,692 B, **0.47 s**, **44 items**, at **12:12:51Z** |
| 2 | Google News RSS, plain brand | `…?q=%22Gymshark%22` | **200**, 125,881 B, **0.56 s**, at **12:12:52Z** |
| 3 | HN Algolia co-mentions | `hn.algolia.com/api/v1/search?query=gymshark&tags=(story,comment)` | **200**, 42,243 B, **0.39 s**, **nbHits 146**, at **12:12:53Z** |
| 4 | Wikidata name → entity | `wbsearchentities?search=Gymshark` | **200**, → `Q56246099`, at **12:14:13Z** |
| 5 | Wikidata entity → website | `wbgetentities?ids=Q56246099&props=claims` | **200**, `P856 = https://www.gymshark.com/`, at **12:22:33Z** |
| 6 | Wikidata same-industry peers (SPARQL) | `query.wikidata.org/sparql`, `wdt:P452` join | **200, 0 rows**, at **12:21:53Z** — see finding 2 |
| 7 | SERP route (DuckDuckGo HTML) | `html.duckduckgo.com/html/?q=gymshark+alternatives` | **202**, 14,228 B — a challenge, not results, at **12:14:12Z** |
| 8 | Reddit search | `reddit.com/search.json?q=gymshark` | **403**, 189,908 B block page, at **12:15:41Z** |
| 9 | Meta Ad Library, keyword → advertisers | via the deployed Worker's browser leg | **200** with real advertiser results, **12:13:25Z** — see the ads engine doc |
| 10 | Jev D1 | `POST 127.0.0.1:4000/jev` | **200**, **p = 0.9**, **0.78 s**, at **12:18:48Z** |

**Probe 1, excerpt** — the three highest-ranked items, verbatim titles:

```
The best activewear brands make working out look good — British GQ (gq-magazine.co.uk)
We're Notoriously Fussy Editors—Our Pick of the 21 Best Gym Leggings You Can Buy — Marie Claire UK
19 activewear brands that actually encourage me to work out — Glamour UK
```

Each `<item>` carries `<title>`, `<link>`, `<pubDate>` and `<source url="…">`. The `source url` is the publisher's registrable domain — that is the field that makes "independent publishers" countable.

**Probe 3, excerpt:** `nbHits: 146`, first three `objectID`s `42603967` ("Uniqlo, Gymshark and Lush stop hiring UK workers via gig economy apps"), `36722027`, `24399879`.

**Probe 10, verbatim:** the request carried `self = {name: Gymshark, domain: gymshark.com, category: DTC gym apparel, country: GB}` and `candidate = {name: Alphalete Athletics, domain: alphaleteathletics.com, evidence: "appears in the same best-gym-leggings roundups; runs Meta ads in GB"}`; the response was `{"answers":{"is_competitor":{"type":"boolean","probability":0.9}}}` — **p = 0.90, exactly at the auto-add threshold**, in 0.78 s for 380 input tokens.

### Findings — three of them change the issue's stated scope

1. **The SERP route in #3884 step 1 is not available at zero spend from our egress.** DuckDuckGo's HTML endpoint answers **202 with a challenge** (12:14:12Z) and Reddit's search JSON answers **403** (12:15:41Z) from this datacenter IP. Google's own SERP is not attemptable at all. The issue's "the SERP route for `<brand> vs`, `<brand> alternatives`" is therefore **replaced by Google News RSS as the roundup harvester** — same intent, same queries, 0.47 s, 200, no key, no scraper. A paid SERP provider remains the only other route and is a money decision for Nish, not a design choice; it is not needed for v1.
2. **Wikidata cannot generate peers.** The `wdt:P452` (industry) self-join for `Q56246099` returned **0 rows** — Gymshark carries no industry statement. Wikidata stays in this engine as a **resolver and enricher** (probe 5 gives the official website, country, inception, HQ and social handles) and is removed as a generator. The control matters too: `Alphalete Athletics` returns **0 hits** from `wbsearchentities`, so the resolver is high-precision and low-recall by measurement, and never gates a candidate.
3. **Outbound links in a roundup article are the publisher's own network, not the brands.** Fetching a real roundup page and counting outbound registrable domains returned `cntraveller.com`, `vogue.co.uk`, `tatler.com`, `gqindia.com` — 30+ sister titles and one ad server, and not one apparel brand. So candidate names come from the **document structure** — headings and emphasised runs inside the article body, which `HTMLRewriter` addresses directly — and never from a link graph. This is why the name → domain resolver below exists at all.

---

## Data flow against the schema

| Step | Reads | Writes |
|---|---|---|
| Generators | `entity` (the self card), `source` (registry rows, for rate limits and `reliability`) | R2: one raw payload per generator run; `snapshot`: **one row per generator run**, with `item_count` and `payload_hash` — the cost boundary, one row per watch per tick |
| Evidence count | those snapshot payloads | nothing |
| Resolve name → domain | — | KV `resolve:<name>` 30-day TTL |
| Jev D1 | `entity`, `suggestion` (dismissal memory), `user_decision` | `jev_verdict`, one row per judged candidate |
| Accept | — | `entity` (`role='competitor'`, `origin='auto'`, `state='on'`), `watch` rows per serveable source, all in one `batch()` |
| Maybe | — | `suggestion` (`status='maybe'`, carrying the D1 verdict and the evidence line) |
| Drop | — | `suggestion` (`status='rejected'`) — `UNIQUE(workspace_id, candidate_domain)` is what makes "dismissed is never re-suggested" true |
| Refresh (D2) | `entity`, `signal` (last 30 days) | `jev_verdict`, `entity.state` / `state_reason` / `state_changed_by='jev'` |

**Never written per candidate:** a `signal` row. A competitor is an `entity`, a suggestion is a `suggestion`; the curated spine stays for things the user reads.

## Workflow / Queue / cron layout

One class, two modes.

```
DiscoveryWorkflow(mode: 'create' | 'refresh', workspaceId, entityId)
  step.do("generators")     → fan out the 4 generators with Promise.allSettled, 8 s each,
                              raw payloads to R2, one snapshot row each   [retries: 3, exponential]
  step.do("count")          → evidence counts, shortlist of 20 + one guaranteed slot per generator
  step.do("resolve")        → name → domain cascade (below), KV-cached
  step.do("judge")          → one Jev request per shortlisted candidate, sequential inside the step
  step.do("write")          → one db.batch(): entities, watches, suggestions, jev_verdicts
  step.do("kick-sweeps")    → enqueue the accepted entities' first collection onto fetch-sweep
```

- **`create`** is started by `IdentityTailWorkflow` the moment the card is confirmed, so discovery has already been running while the user reads the card — that is how the 60-second promise is kept.
- **`refresh`** is started by cron **`0 4 * * 1`** (weekly, Monday 04:00 UTC), one instance per workspace, and runs D2 over existing competitors plus a `create`-shaped pass for new entrants.
- **Queues:** discovery uses **`fetch-sweep`** (`max_concurrency: 20`, no browser) for its own generators. The one generator that needs a browser — Meta Ad Library by keyword — is enqueued on **`page-sweep`** (`max_concurrency: 8`) and its result lands asynchronously; discovery does not block on it, and a late arrival is folded in as extra evidence on the next refresh. Both queues have a dead-letter queue and `max_retries: 3`; shipping a queue without a DLQ deletes messages permanently (`REBUILD-STACK.md` §4.2).
- Step count: 6 per instance. At 100 workspaces weekly plus onboardings, ~2,700 steps a month against **500,000 included**.

**Name → domain resolver, in order, first hit wins:** Wikidata `wbsearchentities` → `P856` (probe 5; precise, ~50% coverage by the Alphalete control) → the slug guess `https://<slug>.com` accepted **only if** the fetched page's `og:site_name` or `ld+json` `Organization.name` matches the candidate name (a string comparison, which is ground truth) → otherwise the candidate is shown to the user by name in the "maybe" list, and the user's tap resolves it through the identity engine. No search API, no guessing left in the database.

## Jev decisions used

| Id | Primitive | Where | Context pack fields |
|---|---|---|---|
| **D1** `is_competitor` | Noul | one per shortlisted candidate | `self` (the full card), `subject` = the candidate with its evidence, `competitor_set` (so Jev knows the field already covered), `item` (the evidence excerpts and their source URLs), `user_memory` (dismissed domains, brands turned off), `reliability` (per generator: `rss` for News, `best_effort` for HN, `scraped_page` for the ad library) |
| **D2** `still_competitor` | Noul + Choice `reason` | refresh mode, one per tracked competitor | the same, plus `history_30d` — the subject's last 30 days of signals |

Thresholds, applied exactly as `REBUILD-JEV.md` states: D1 at **p ≥ 0.9** adds the brand with tracking ON; **p ≤ 0.1** drops it and remembers the rejection; between is a "maybe" with Jev's one-line reason. The live probe returned **0.90** — the boundary case — and the packet must show that boundary handled as "add", not as "maybe".

D2 auto-retires **only** at p ≤ 0.1 **and** `reason ∈ {acquired, shut down}`; `dormant` and `pivoted` always ask. A user-added brand is never auto-retired.

## Cost line

Per discovery run (one brand), priced from `REBUILD-COST.md` (2026-09-21):

| Leg | Units | Per 1,000 runs |
|---|---|---|
| 4 generator fetches + ~5 article fetches | 9 subrequests, all sub-second | 9,000 subrequests — inside 10M included |
| Meta Ad Library keyword leg (browser, async) | ~7 browser-seconds | **1.94 browser-hours** |
| Queue | ~10 messages × 3 operations | 30,000 ops — **$0.012** |
| Jev | ~26 calls (20 shortlist + 6 guaranteed) | 26,000 calls; $0 on the seat, **$0.41** at the measured market rate |
| D1 | 4 snapshot rows + ~12 entity/watch/suggestion rows + 26 verdict rows ≈ 42, one `batch()` | 42,000 rows — **0.08% of the 50M included** |
| R2 | 4 PUTs, ~150 KB total | 4,000 Class A — **$0.018** |
| Workflow | 6 steps | 6,000 steps — inside 500,000 included |

**Monthly at 100 brands:** one create per brand plus four refreshes each = 500 runs → **0.97 browser-hours** (inside the 10 h allotment), **21,000 D1 rows written** (0.04% of included), **15,000 queue operations**, **13,000 Jev calls** ($0 on the seat, **$0.21** at market). **Cloudflare cost: $0.00.**

The number to watch is not money, it is the browser leg: if the ad-library generator is ever run synchronously inside onboarding it becomes 7 seconds of the 60-second budget **and** a slot out of the capped 8. It is asynchronous by design for that reason.

## Failure modes and the degraded state the UI shows

| Failure | Detection | What the user sees |
|---|---|---|
| Every generator is empty or slow | zero candidates at the end of `count` | "we're still looking, add one you know and we'll keep going" — the input stays, the Competitors page fills as results land (`REBUILD-ONBOARDING.md` step 4) |
| One generator down (GDELT-style 429, crt.sh-style 502) | non-2xx or empty, recorded on its `snapshot` row | that source shows **degraded** on the Competitors page with the date it last returned; never retried harder — the rate limit lives on the `source` row and the Workflow honours it (`REBUILD-GUARDRAILS.md`) |
| Name cannot be resolved to a domain | resolver cascade exhausted | the candidate appears in "maybe" as a name with its evidence line; tapping it runs the identity engine |
| Jev unreachable | HTTP error after the step's retries | candidates are stored `unjudged`, the list shows what the counts alone support with a "still checking these" line, and the next tick judges them. Nothing is dropped (`REBUILD-JEV.md` principle 4) |
| Jev in the uncertain band | 0.1 < p < 0.9 | the "maybe" list, low, with Jev's one-line reason. Never auto-added |
| A takedown subject appears as a candidate | `takedown` lookup before the shortlist | silently excluded, and dropped from any workspace already tracking it at the next tick with a one-line note to the owner |
| The same brand is suggested twice | `UNIQUE(workspace_id, candidate_domain)` | it cannot be. A dismissed suggestion is never re-suggested — that constraint is the mechanism |

---

## PACKETS

### P1 — the generator contract and two RSS/JSON generators

**GOAL.** Define `Generator = (subject, env) => Promise<Candidate[]>` where `Candidate = { name, domain?, evidence: { sourceUrl, excerpt, generator }[] }`, and implement Google News roundup harvest and HN Algolia co-mentions against it.

**STOCK FEATURE OR LIBRARY.** `@extractus/feed-extractor` **8.0.3** via `extractFromXml(xml)` so the Worker does its own `fetch` (`REBUILD-STACK.md` §5.3); `HTMLRewriter` (platform) for pulling headings and emphasised runs out of a roundup article; `zod` **4.6.5** for the candidate shape; `fetch` with `AbortSignal.timeout(8000)`.

**FILES IN SCOPE.** `app/lib/discovery/types.ts`, `app/lib/discovery/generators/news.ts`, `app/lib/discovery/generators/hn.ts`, `tests/unit/discovery/generators.test.ts`, `tests/fixtures/gnews-gymshark-2026-09-21.xml`, `tests/fixtures/hn-gymshark-2026-09-21.json`.

**FORBIDDEN.** `rss-parser` and `feedparser` (both rejected in `REBUILD-STACK.md` §5.3 — the first requires Node's HTTP client at module load). Any SERP scrape: DuckDuckGo returned **202** and Reddit **403** from our egress; do not re-discover this. Harvesting candidate names from a link graph — measured and refuted above. A hand-written publisher denylist: unwanted domains are Jev's to reject, not code's.

**PROOF REQUIRED.** Run both generators live on Gymshark and on a control brand, printing candidate names with their evidence URLs and the item counts (the News feed returned 44 items and HN 146 hits on 2026-09-21; cite today's numbers, not these). Committed fixtures make the unit tests deterministic.

**PUSH.** `wip/issue-3884-p1`.

**COST.** 2 fetches + up to 5 article fetches per run, all sub-second, no browser. R2: one payload PUT per generator.

### P2 — evidence counting and the shortlist

**GOAL.** From all candidates produce the judged shortlist: dedupe by resolved domain then by normalised name, count independent generators and independent publisher domains, take the top 20, and add the top unique candidate from each generator.

**STOCK FEATURE OR LIBRARY.** Plain TypeScript arithmetic — this is explicitly code's job, not Jev's (`REBUILD-JEV.md`, "What Jev is not used for: anything with a ground truth the code can read … counts"). `tldts` **7.4.13** for registrable-domain equality.

**FILES IN SCOPE.** `app/lib/discovery/shortlist.ts`, `tests/unit/discovery/shortlist.test.ts`.

**FORBIDDEN.** Fuzzy string matching beyond exact normalised-name equality — D8 owns similarity judgments. A score formula with tuned weights: the count is the count. Calling Jev from this module at all.

**PROOF REQUIRED.** A table from the real P1 output: candidate, generators that produced it, publisher count, whether it made the shortlist and why. The guaranteed-slot rule shown firing on a candidate with evidence count 1.

**PUSH.** `wip/issue-3884-p2`.

**COST.** Pure computation. Zero.

### P3 — the name → domain resolver

**GOAL.** Given a candidate name, return `{ domain, via: 'wikidata'|'slug'|'unresolved' }` using the cascade: Wikidata `wbsearchentities` → `wbgetentities` `P856`; then the slug guess accepted only on an exact `og:site_name` / `ld+json` name match; else `unresolved`.

**STOCK FEATURE OR LIBRARY.** `fetch` + the P2 extractor from the identity engine (`HTMLRewriter`); Workers KV for a 30-day resolution cache; `zod` **4.6.5**.

**FILES IN SCOPE.** `app/lib/discovery/resolve-domain.ts`, `tests/integration/discovery/resolve.test.ts`.

**FORBIDDEN.** Accepting a slug guess without the name match — a 200 from `<slug>.com` proves a parked domain exists, nothing more. Any search API. Storing an unresolved candidate as an `entity`.

**PROOF REQUIRED.** Live, with both outcomes on real names: `Gymshark` → `gymshark.com` via Wikidata `P856` (cite the claim), and `Alphalete Athletics` → **0 Wikidata hits** falling through to the slug branch with the name-match evidence printed. One deliberate `unresolved` showing the candidate surviving as a named "maybe".

**PUSH.** `wip/issue-3884-p3`.

**COST.** 1–3 sub-second fetches per unresolved name, KV-cached 30 days. No browser.

### P4 — D1/D2 judgment and the write

**GOAL.** Build the context pack, call Jev per shortlisted candidate, apply the thresholds exactly, and write entities, watches, suggestions and verdicts in one `db.batch()`. `refresh` mode runs D2 with `history_30d`.

**STOCK FEATURE OR LIBRARY.** The Jev client from the identity engine's P4 (same wire shape: `questions` record, `boolean` for the Noul, `choice` with `criteria` for D2's reason). D1 `batch()`.

**FILES IN SCOPE.** `app/lib/discovery/judge.ts`, `app/lib/discovery/persist.ts`, `tests/integration/discovery/judge.test.ts`.

**FORBIDDEN.** Ranking by the returned probability — order is the evidence count, per the decision above. Running D1 on a user-added brand. Auto-retiring on `dormant` or `pivoted`. Any candidate written as an `entity` without a resolved domain and at least one serveable source (`#3884` scope step 3).

**PROOF REQUIRED.** Three real brands from a **cold database** — a DTC brand, a SaaS and a creator — each with the full ranked list, every candidate's evidence, its Jev `question_id`, `input_hash`, probability and `jev_verdict` row id, and the action taken, all timestamped. The p = 0.9 boundary shown adding, not asking. One dismissed suggestion proven un-resuggestable by re-running discovery and showing the constraint hold.

**PUSH.** `wip/issue-3884-p4`.

**COST.** ~26 Jev calls per run ($0 on the seat, $0.0004 at market), ~42 D1 rows in one batch. State both in the PR.

### P5 — the Workflow, the cron and the Competitors screen

**GOAL.** `DiscoveryWorkflow` with the six steps above in both modes, the weekly cron, and the Competitors page: accepted brands ON, maybes as a short second list, per-brand on/off/dismiss, "add a competitor" as one input.

**STOCK FEATURE OR LIBRARY.** Cloudflare Workflows (`step.do` with `{ retries: { limit: 3, backoff: "exponential" } }`), Cron Triggers `"0 4 * * 1"`, Queues `fetch-sweep` / `page-sweep` with DLQs, React Router **8.4.0** routes, `shadcn` **4.21.0**.

**FILES IN SCOPE.** `workers/discovery-workflow.ts`, `workers/schedule.ts`, `wrangler.jsonc`, `app/routes/competitors.tsx`, `e2e/competitors.spec.ts`.

**FORBIDDEN.** Doing the work inline in `scheduled()` — cron → Workflow, always (`REBUILD-STACK.md` §4.10). `setTimeout`/`setInterval`. Commenting out the `crons` key to disable a job (documented not to work — set `crons: []`). A `step.do` per candidate: one step judges the shortlist. Returning generator payloads from a step instead of R2 keys (1 MiB step-output cap). A queue without a `dead_letter_queue`.

**PROOF REQUIRED.** One real weekly refresh run end to end on a live workspace: instance id, each step's outcome, at least one `step.do` retry in the run history, the D2 verdicts with reasons, and a brand turned off by a user shown stopping collection while keeping history. Playwright at 1440 and 390 on the Competitors page, no horizontal scroll, no console errors.

**PUSH.** `wip/issue-3884-p5`.

**COST.** 6 steps per instance; 500 instances a month at 100 brands = 3,000 steps against 500,000 included. Cron itself is ordinary Workers requests.
