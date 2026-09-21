# Engine: identity card

Issue #3885. Umbrella #3842. Author: the Opus architect, **2026-09-21**. Designed against `docs/REBUILD-SCHEMA.md`, `REBUILD-JEV.md`, `REBUILD-ONBOARDING.md`, `REBUILD-COST.md`, `REBUILD-GUARDRAILS.md` (#3899) and `REBUILD-STACK.md` (#3906). Every version below comes from the stack doc; every probe below was run today from this VPS and is timestamped UTC.

The job: one input — a domain, a URL, an `@handle` or a channel URL — becomes a confirmed brand card in under 30 seconds, with no form anywhere.

---

## The two candidate shapes

### Candidate A — in-request fan-out, streamed to the card

The identity route's loader starts every source probe at once as promises and returns them unawaited. React Router 8 streams them to the browser; each field renders the moment its probe resolves, through `<Await>`. Each probe carries its own 8-second deadline. When the probes settle (or the deadline fires), one batched Jev call judges every field at once (D7), one D1 `batch()` writes the card, and a Workflow instance is started for the durable tail — discovery, first snapshots, first ad pull.

- The card genuinely draws itself field by field: the transport is the same HTTP response the user is already reading.
- Zero queue operations, zero Durable Objects, zero extra platform pieces.
- Nothing durable exists until the write at the end. Close the tab at second 20 and the work is gone.

### Candidate B — durable assembler, Queue fan-out into a Durable Object

The submit action enqueues one message per source on a queue. Each consumer invocation probes its source and writes its fields into a per-onboarding Durable Object. The DO holds the partial card, pushes it to the browser over its WebSocket, and at the 8-second deadline calls Jev once, writes D1, and completes.

- Durable from the first second; a refresh reattaches to the DO and the card is still filling.
- Per-source isolation is structural — a source that throws cannot take the card down.
- Every field costs a queue round trip (three billed operations each) plus a DO instance per onboarding, and the live-update path becomes a WebSocket the rest of the app does not use.

## Screening

**The deciding question is what durability is actually worth here**, because both shapes satisfy the onboarding contract's visible behaviour.

The work being protected is 6–10 HTTP probes that take about a second each and cost nothing. Candidate B spends a Durable Object, a queue, a WebSocket and roughly 30 queue operations per onboarding to protect eight seconds of work that can simply be repeated. Worse, it puts the *interactive* path behind the same queue mechanism the sweeps use, which is exactly where the browser-concurrency cap lives — the first customer-facing screen in the product would be queued behind competitor sweeps.

**Where B is genuinely better:** resume. A user who reloads mid-build in Candidate A re-runs every probe.

**Where they are equal:** the Jev batching, the D1 write shape, and the durable tail. Both end in one Jev call, one `batch()`, one Workflow.

## Decision

**Candidate A wins.** It is the shape with the fewest moving parts that still meets the contract, and it keeps onboarding off the capped sweep path.

**Grafted from B:**

1. **Resume without a DO.** Every probe result is cached in KV under `identity:<registrable-domain>:<probe>` with a 24-hour TTL. A reload, a second workspace on the same domain, and the discovery engine re-asking for the same card all hit the cache. Cost: one KV read per probe instead of a queue round trip. KV is right here and wrong for counters — read-mostly, tolerant of the 60-second propagation window, never same-key hot (`REBUILD-STACK.md` §4.5).
2. **The durable tail is a Workflow**, started before the response finishes: `IdentityTailWorkflow` persists the confirmed card, creates `watch` rows, starts discovery and enqueues the first snapshot sweep. B's durability argument is right about the part that matters — the part after the user taps "That's me".
3. **Per-source isolation as a rule, not a hope.** Every probe is wrapped in one helper that returns `{ ok, value } | { ok: false, reason }` and never throws; the card renders a reason line, never an error.

**Rejected from B, recorded so it is not re-litigated:** a Durable Object per onboarding. If onboarding ever grows a leg that genuinely takes minutes (a paid enrichment provider, a multi-page crawl), that leg moves into `IdentityTailWorkflow` and fills the card afterwards — it does not bring back the assembler.

---

## Live probes — one per upstream, on Gymshark

All run from this VPS on **2026-09-21**, times UTC.

| # | Upstream | Call | Result |
|---|---|---|---|
| 1 | Brand homepage | `GET https://www.gymshark.com/` (Chrome UA) | **200**, 1,608,007 B, **1.07 s**, at **12:12:39Z** |
| 2 | Same, no UA header | `GET https://www.gymshark.com/` | **200**, 1,607,995 B — the origin does not gate on a missing UA from this egress |
| 3 | Web app manifest | `GET /site.webmanifest` | **200**, 298 B, at **12:14:11Z** — `"name": ""`, `"short_name": ""`, one 192×192 icon |
| 4 | Icon fallback | `GET https://icons.duckduckgo.com/ip3/gymshark.com.ico` | **200**, `image/png`, 1,313 B |
| 5 | Wikidata search | `wbsearchentities?search=Gymshark` | **200**, 527 B, → **Q56246099**, at **12:14:13Z** |
| 6 | Wikidata claims | `wbgetentities?ids=Q56246099&props=claims` | **200**, 25,597 B, **0.36 s**, at **12:22:33Z** |
| 7 | Browser Rendering REST | `POST /accounts/<id>/browser-rendering/markdown` | **401 Authentication error**, at **12:15:10Z** and **12:15:20Z** — see the finding below |
| 8 | Jev (D7 shape) | `POST 127.0.0.1:4000/jev` | **200**, **0.78 s**, at **12:18:48Z** |

**Probe 1, response excerpt** (what the extractor gets, verbatim from the fetched HTML):

```html
<meta property="og:site_name" content="Gymshark" data-next-head=""/>
<meta property="og:title" content="Gymshark Official Store - Gym Clothes &amp; Workout Clothes" data-next-head=""/>
<meta property="og:image" content="http://cdn.shopify.com/s/files/1/0098/8822/files/gymshark_social_banner_1200x1200.jpg?v=1549554764"/>
<link rel="apple-touch-icon" sizes="120x120" href="/apple-touch-icon-120x120.png"/>
<link rel="manifest" href="/site.webmanifest"/>
```

and one `application/ld+json` block of `"@type":"Organization"`:

```json
{"@type": "Organization", "name": "Gymshark", "url": "https://www.gymshark.com",
 "logo": "https://images.ctfassets.net/wl6q2in9o7k3/QN3GChnXFjOolrl6zNQBp/.../Gymshark_Combi_Logo_Black.png?w=1664&q=85&fm=webp",
 "sameAs": ["https://www.facebook.com/Gymshark/", "https://twitter.com/Gymshark", "https://www.instagram.com/gymshark/", ...]}
```

Social handles recovered from the same document: `instagram.com/gymshark`, `tiktok.com/@gymshark`, `youtube.com/user/GymSharkTV`, `twitter.com/Gymshark`, `facebook.com/Gymshark`.

**Probe 6, response excerpt** — claims present include `P856` (official website) `https://www.gymshark.com/`, `P17` country `Q145` (United Kingdom), `P571` inception `2012`, `P159` HQ `Q397343`, plus `P2002` (X), `P2003` (Instagram), `P2013` (Facebook), `P7085` (TikTok).

**Probe 8, request and response, verbatim:**

```json
// POST /jev
{"state":{"self":{"name":"Gymshark","domain":"gymshark.com","category":"DTC gym apparel","country":"GB"},
          "candidate":{...}},
 "questions":{"is_competitor":{"type":"boolean","instructions":"Is the candidate a real competitor of self?"}}}
// 200, 0.78 s
{"answers":{"is_competitor":{"type":"boolean","probability":0.9}},
 "rounding":{"probabilityDecimals":2},"usage":{"inputTokens":380,"outputTokens":23},
 "providerMetadata":{"gateway":{"cost":"0","marketCost":"0.00001596"}}}
```

That is the wire contract every engine here uses: `questions` is a **record** of ids, each `{ type: "boolean" | "choice" | "score", instructions, criteria? }`; `choice` requires `criteria` as a record of option → description; answers come back keyed by the same ids, with `probability` for booleans and `choice` + `probabilities` for choices. Several questions in one request is the supported shape, which is what makes the onboarding contract's "all Jev field checks in one batched request" true rather than aspirational.

### Findings

1. **The brand homepage answered a plain fetch from this VPS, with and without a browser UA.** `REBUILD-KEEPLIST.md` finding 6 — that `gymshark.com` returns `fetch_failed` to workerd — is about **workerd's fetch signature**, not the origin's tolerance of datacenter IPs, and my probe cannot and does not contradict it. The design keeps the browser path, but as an **escalation**, not as the default: cheap fetch first, browser when the fetch is refused or yields no copy. The measured saving is the whole cost model (1.07 s of Worker time versus ~8 browser-seconds).
2. **The manifest is empty on a brand that has one.** `"name": ""` — so `site.webmanifest` is an icon source, never a name source. The name cascade is `ld+json Organization.name` → `og:site_name` → `<title>` minus the tagline → Wikidata label.
3. **The Cloudflare tokens on this host cannot call Browser Rendering.** `~/.config/cloudflare/deploy-ci.env`'s token verifies active (`/user/tokens/verify` → 200, id `1bfdb479e69ca9e9393c43111f75ca51`) but both it and `deploy.env`'s token return `{"code":10000,"message":"Authentication error"}` on `/browser-rendering/markdown`. The Worker binding needs no token, so this blocks nothing in production — but a packet that wants to prove the browser leg from CI or the VPS needs a token with **Browser Rendering: Edit**, and that is Nish's to mint. Every browser proof in these packets is therefore specified against the deployed Worker, not against REST.
4. **Wikidata is high precision, low recall.** Gymshark resolves; the control, `Alphalete Athletics`, returns **0 hits** (`wbsearchentities`, 12:22:33Z). It enriches; it never gates.

---

## Data flow against the schema

Tables by name, in write order:

1. `workspace` — exists from sign-in; nothing written here.
2. **KV** `identity:<domain>:<probe>` — probe cache, 24 h TTL. No D1 write.
3. `jev_verdict` — one row per D7 field plus one for `public_subject`, all from the single batched call, written in the same `batch()` as the card. `UNIQUE(question_id, input_hash)` means a reload re-uses the verdict instead of paying for it again.
4. `entity` — one row, `role='self'`, `state='on'`, `origin='user_input'`, `identity_json` the card, `domain` the registrable domain. The partial unique index pins one `self` per workspace.
5. `page` — one row for the homepage plus each page found in the nav that the D9 choice classifies; `role` and `role_decided_for_hash` set from that call.
6. `source` — **read only**. The registry is global; onboarding never writes it.
7. `watch` — one row per (entity, source, target) the card proves we can serve: ads where an ad-library id or advertiser name was found, site for the homepage and the pricing page, mentions for the brand name, hiring where a board was found.
8. `snapshot` — the first homepage snapshot: one row, `payload_r2_key` pointing at the stored HTML, `payload_hash` over **extracted text**, `item_count`, `fetched_at`.
9. `user_decision` — one row per field the user edits on the card. This is the `user_memory` the Jev context pack reads on every later judgment; an edited field is never re-judged against the extracted value.

Everything from step 3 to step 9 is **one `db.batch()`** — about 20 rows for a typical brand.

## Workflow / Queue / cron layout

| Piece | Where | Number |
|---|---|---|
| Probes | The identity route's loader, streamed with `<Await>` | 6–10 parallel, 8 s deadline each |
| Browser escalation | `env.BROWSER.quickAction("content", …)` called **directly**, never through a queue | at most 1 per onboarding; uses the 2 browser slots reserved off the sweep cap |
| Jev | one batched call after the probes settle | 1 |
| The durable tail | `IdentityTailWorkflow`, one instance per confirmed card | steps: `persist` → `seed-watches` → `start-discovery` → `enqueue-first-sweep` |
| Cron | **none** | onboarding is user-triggered by definition |

**The browser cap, as a config value.** `wrangler.jsonc` carries `"vars": { "BROWSER_CONCURRENCY_CAP": "10" }` and the two sweep queues carry `max_concurrency: 8` and `max_concurrency: 20` (the second never touches a browser). Eight capped sweep slots plus two interactive slots is the whole cap; onboarding's escalation uses the reserved two so a customer's first screen never waits behind a sweep. Raising the cap costs $2.00 per additional concurrent browser per month and needs Nish's recorded yes (`REBUILD-COST.md`, Nish's standing rule of 2026-09-21).

## Jev decisions used

| Id | Where | Context pack fields it needs |
|---|---|---|
| **D7** `identity_field_confidence` | one boolean per field — name, logo, description, category, country, socials, pricing page — all in one request | `item` (the extracted value and which probe produced it), `reliability` (the source's registry row), `subject` (whatever is known so far) |
| **D7+** `public_subject` | same request, one extra boolean | `item` (the input and the homepage excerpt), `self` — required by `REBUILD-GUARDRAILS.md`: below 0.1 the input is refused with "we track brands and creators, not people"; between, the user is asked |
| **D9** `page_role` | one choice per page found in the nav, cached by URL + title hash | `subject`, `item` (URL and title) |

The D9 shape is proven live: at **12:19:10Z**, `{"url":"https://www.gymshark.com/collections/all-products","title":"All Products | Gymshark"}` returned `{"choice":"pricing","probabilities":{"pricing":0.81,"other":0.16,"product":0.02,"home":0.01,...}}` with `providerMetadata.typesafe.confidence.page_role = 0.78`, in **0.33 s**. A URL regex would have called that page `other`; this is why D9 exists.

Per the contract, **a Choice is recorded and displayed, never acted on automatically** — `page_role` selects the snapshot schedule and feeds D3, both of which are gated by Nouls downstream.

## Cost line

Priced from `docs/REBUILD-COST.md` (read 2026-09-21). One identity build:

| Leg | Units | Per 1,000 builds |
|---|---|---|
| Probe fetches (6–10, sub-second, no browser) | Workers requests + subrequests | ~8,000 subrequests, inside the 10M included |
| Browser escalation (only when the fetch is refused; assume 25%) | browser-seconds | 250 × 8 s = **0.56 browser-hours** |
| KV | 8 reads + 8 writes per build | 8k reads ($0.004), 8k writes ($0.04) |
| Jev | 1 batched call, 380 in / 23 out measured | $0 on the system seat; **$0.016** at the measured market rate of $0.00001596/call |
| D1 | ~20 rows in one `batch()` | 20,000 rows written — **0.04% of the 50M included** |
| R2 | 1 PUT (homepage snapshot ~1.6 MB raw, ~200 KB extracted) | 1,000 Class A ($0.0045), ~0.2 GB-mo ($0.003) |

**Monthly at 100 brands: $0.00.** Onboarding happens once per brand — 100 builds a month is 0.06 browser-hours, 2,000 D1 rows and 100 Jev calls, every line inside the included tier. The recurring cost of a tracked brand belongs to the sweep engines, not here.

## Failure modes and the degraded state the UI shows

| Failure | Detection | What the user sees |
|---|---|---|
| Homepage refuses the plain fetch | non-2xx, or extracted text under 200 characters | nothing — the browser escalation runs silently; the `page` row is marked `transport='browser'` so later sweeps skip the wasted fetch |
| Homepage refuses the browser too | quick action error or empty content | the card still appears from Wikidata, socials and ad libraries; the site fields read "we'll fill this on the first crawl, within the hour" and `IdentityTailWorkflow` retries hourly for 24 h |
| A single probe times out at 8 s | the deadline | that field reads "still looking" and fills from the tail Workflow; the card is never held |
| Jev unreachable or slow | HTTP error or 8 s deadline | every field renders as extracted, outlined as "check this"; the items are `unreviewed` and the tail Workflow re-judges. The UI never waits on Jev (`REBUILD-JEV.md` principle 4) |
| `public_subject` below 0.1 | D7+ verdict | the input is refused with the guardrails line, the input stays focused, and the refusal is recorded |
| Subject on the takedown list | `takedown` row lookup before any probe | refused with the same line; no probe is made at all |
| Nothing found anywhere | all probes empty | "we couldn't find anything for that, try the main website" — one line, no error page |

The card never shows a spinner in place of a field. Every empty field says what will fill it and when, per the onboarding contract.

---

## PACKETS

### P1 — input normalisation and the probe cache

**GOAL.** Turn any of `gymshark.com`, `https://www.gymshark.com/en-GB/`, `@gymshark`, `https://www.youtube.com/user/GymSharkTV` into a canonical subject `{ kind: 'domain'|'handle'|'channel', registrable, url, platform? }`, and add the 24-hour KV probe cache around it.

**STOCK FEATURE OR LIBRARY.** `URL` and `URL.canParse` (platform); `tldts` **7.4.13** (npm `latest`, published 2026-09-13, read 2026-09-21) for the registrable domain + public-suffix handling (**this is an addition to `docs/REBUILD-STACK.md` — add the row in this PR**; it is 0 dependencies and the only maintained PSL implementation that ships a Workers-clean ESM build); `zod` **4.6.5** for the parsed shape; Workers KV binding for the cache.

**FILES IN SCOPE.** `app/lib/identity/normalise.ts`, `app/lib/identity/probe-cache.ts`, `docs/REBUILD-STACK.md` (one row), `tests/unit/identity/normalise.test.ts`.

**FORBIDDEN.** A hand-written public-suffix list or a `split('.')` domain parser. A regex for handles that does not round-trip the four inputs above. Any cache other than the KV binding. Writing to D1.

**PROOF REQUIRED.** A table of 12 real inputs → normalised output, including the four above, `bbc.co.uk` (two-label suffix), a punycode domain and an input that must be rejected. `npm run typecheck` clean; tests green.

**PUSH.** Branch within 5 minutes; `git push -f origin HEAD:refs/heads/wip/issue-3885-p1` after every slice.

**COST.** KV only: 1 read + 1 write per probe per brand, 24 h TTL. At 100 onboardings/month, 800 reads and 800 writes — $0.004 total. No D1, no browser.

### P2 — the extractor

**GOAL.** From one HTML response produce `{ name, description, logoUrl, socials[], ldOrganization, navLinks[], adLibraryHints[] }`, plus the normalised visible text used for hashing.

**STOCK FEATURE OR LIBRARY.** `HTMLRewriter` (platform, `REBUILD-STACK.md` §5.1 and §5.4) — no HTML-to-text or scraper dependency. `zod` **4.6.5** for the output shape.

**FILES IN SCOPE.** `app/lib/identity/extract.ts`, `app/lib/identity/logo-cascade.ts`, `tests/unit/identity/extract.test.ts`, `tests/fixtures/gymshark-2026-09-21.html`.

**FORBIDDEN.** `cheerio`, `html-to-text`, `metascraper`, `open-graph-scraper`, `jsdom`, `linkedom` — all rejected with reasons in `REBUILD-STACK.md` §5.1/§5.4. Concatenating `text()` chunks without checking `lastInTextNode` (the documented trap; getting it wrong fills every later diff with phantom changes). `HEAD` requests in the logo cascade — `stripe.com` answers HEAD with `content-length: 0` and GET with 15,086 bytes. Trusting a 200 from an icon proxy without checking `res.ok`.

**PROOF REQUIRED.** Run against the committed Gymshark fixture and assert the exact values this design cites: `og:site_name` `Gymshark`, the `ld+json` `Organization.logo` Contentful URL, the five social handles, and `"name": ""` from the manifest proving the name cascade skips it. Logo cascade order asserted by test with all but one step failing.

**PUSH.** `wip/issue-3885-p2`.

**COST.** Zero bundle bytes (platform primitive), zero network beyond the page already fetched.

### P3 — the fetch-then-browser transport

**GOAL.** One function: given a URL, return `{ html, transport: 'fetch'|'browser', status, ms }`, trying plain `fetch` first and escalating to Browser Rendering when the fetch is refused (non-2xx), returns a challenge body, or yields under 200 characters of extracted text.

**STOCK FEATURE OR LIBRARY.** `fetch` (platform) with an 8 s `AbortSignal.timeout`; Browser Rendering binding `env.BROWSER.quickAction("content", { url })` — Quick Actions, **not** a puppeteer session, because it needs no `nodejs_compat` and no browser lifecycle (`REBUILD-STACK.md` §4.3). Log `X-Browser-Ms-Used` per escalation.

**FILES IN SCOPE.** `app/lib/fetch/transport.ts`, `workers/` binding declarations in `wrangler.jsonc`, `tests/integration/transport.test.ts`.

**FORBIDDEN.** `browser.close()` per request — use `disconnect()` if a session is ever opened. Going through a queue: this path is interactive and uses the two reserved browser slots. Retry loops — one escalation, then a typed failure. A third transport.

**PROOF REQUIRED.** Deployed, on a real brand: one URL served by `fetch` and one served by the browser escalation, each with status, elapsed ms and (for the browser) the `X-Browser-Ms-Used` value, cited with timestamps. State in the PR whether the escalation fired on `gymshark.com` from workerd — that is the open question `REBUILD-KEEPLIST.md` finding 6 leaves, and this packet is where it gets answered with evidence.

**PUSH.** `wip/issue-3885-p3`.

**COST.** Per escalation ~8 browser-seconds. Budget: **at most 1 escalation per onboarding**, enforced by the caller, not by this module.

### P4 — the batched Jev call and the card write

**GOAL.** Build the context pack, send one Jev request carrying every D7 field question plus `public_subject`, apply the thresholds, and write the whole card in one `db.batch()`.

**STOCK FEATURE OR LIBRARY.** TypeSafe Jev through the shipped plugin/SDK, the wire shape proven above (`questions` as a record of `{type, instructions, criteria?}`). D1 `batch()` (platform). `zod` **4.6.5** for both the pack and the answer.

**FILES IN SCOPE.** `app/lib/jev/client.ts`, `app/lib/jev/context-pack.ts`, `app/lib/identity/card.server.ts`, `tests/integration/identity/card.test.ts`.

**FORBIDDEN.** One Jev call per field. A retry loop, a prompt-templating library, or a local fallback model (`REBUILD-JEV.md` principle 5). Acting on a Choice automatically. Writing rows one statement at a time. Skipping `jev_verdict` rows — every verdict is logged with `question_id`, `input_hash`, `p`, `reason`, `decided_at`, including the ones that did nothing.

**PROOF REQUIRED.** One real brand end to end: the context-pack hash, the single request with its question ids, every returned probability, the action taken per field, and the `jev_verdict` row ids with timestamps. One field in the uncertain band shown outlined as "check this" and **not** auto-filled. One `public_subject` refusal on a real private handle, recorded.

**PUSH.** `wip/issue-3885-p4`.

**COST.** 1 Jev call per onboarding — measured 380 input / 23 output tokens, $0 on the system seat, $0.00001596 at market. ~20 D1 rows in one batch.

### P5 — the card UI and the durable tail

**GOAL.** The streaming card screen (fields appear as probes resolve, every field editable in place, one action "That's me") and `IdentityTailWorkflow` that persists, seeds `watch` rows, starts discovery and enqueues the first sweep.

**STOCK FEATURE OR LIBRARY.** React Router **8.4.0** framework mode: loader returns promises, `<Await>` + `<Suspense>` render them as they land. Cloudflare Workflows (platform) with `step.do` retries for the tail. `shadcn` **4.21.0** components, Tailwind **4.3.3** tokens.

**FILES IN SCOPE.** `app/routes/onboarding.identity.tsx`, `app/components/identity-card.tsx`, `workers/identity-tail-workflow.ts`, `wrangler.jsonc` (the workflow binding), `e2e/onboarding-identity.spec.ts`.

**FORBIDDEN.** A form with labelled fields — the card is the form (`REBUILD-ONBOARDING.md`). A spinner standing in for a field: an empty field says what will fill it. Client-side polling of the workflow instance. A `step.do` per line of code — steps are the billing unit and each is a durable boundary (`REBUILD-STACK.md` §4.1). Returning a page snapshot from a step instead of an R2 key (1 MiB step output cap).

**PROOF REQUIRED.** Three real inputs — a company domain, a creator handle, a bot-blocking brand site — recorded with Playwright **1.63.0** at 1440 and 390: input-to-first-field, input-to-card-complete, card-to-competitors, each stage timed against the 30 s budget, plus which source filled each field. One `step.do` retry visible in the workflow run history, cited by instance id.

**PUSH.** `wip/issue-3885-p5`.

**COST.** Workflow: 1 instance per onboarding, 4 steps — 400 steps/month at 100 brands against 500,000 included. No browser unless P3 escalates.
