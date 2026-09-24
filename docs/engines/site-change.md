# Engine: site-change tracking — competitors and the user's own site

Issue #3879. Umbrella #3842 (charter addendum, Nish 2026-09-21: website change tracking is a first-class signal, and it runs on the user's own site too). Author: the Opus architect, **2026-09-21**. Probes run from this VPS today; times UTC.

The job: snapshot each tracked brand's key pages, detect real changes, let Jev decide what is noteworthy, and show the survivors as before-and-after marks. On the user's own site the same engine guards the house — a break reaches Alerts immediately, not on the weekly cadence.

## As built (2026-09-24)

The first slice runs every night and files real changes. Where it departs from the packets below, and why:

- **Scheduling is the Workflow's own `schedules` entry**, not a Worker cron plus queues. One `site-sweep` instance a night at 02:00 UTC; each page is its own retried `step.do`, and publishing a change is a second step so a retry never loses or duplicates a signal. Queues would need a queue created in the account first, which the deploy token cannot do; a Workflow is created by the deploy itself. Pages run one at a time, so the sweep never holds more than one browser.
- **Homepages only, for now.** Picking a brand's pricing page is D9, a Jev judgment, and Jev is not reachable from the Worker yet. The `page` table already carries `role`, so pricing pages join the same sweep once D9 is wired.
- **Changes are filed unjudged.** Every text-hash change becomes a `signal` with the before and after evidence. D3 `noteworthy_change` decides which ones reach customers as marks once Jev is wired; until then the standing's noteworthy bucket counts none of them.
- **The own-site hourly lane and incidents (P6) are the next slice.**

---

## The two candidate shapes

### Candidate A — browser-first snapshot

Every page, every tick, goes through Browser Rendering's `/snapshot` quick action, which returns content, markdown and a screenshot in one call. Hash the markdown, diff it against the previous one, judge.

- One code path, one transport, no escalation logic, and a screenshot always available for the before-and-after mark.
- Renders JS-only marketing sites correctly by construction.
- At 100 brands × 4 pages × ~8 s that is **26.7 browser-hours a month**, against an allotment of 10 — and it pays that price on every unchanged page, which is most of them.

### Candidate B — cheap path first, browser on escalation

Plain `fetch` + `HTMLRewriter` extraction → normalised visible text → hash → compare with the previous `snapshot.payload_hash`. Identical: one snapshot row, done. Changed: escalate to Browser Rendering for the screenshot pair and a re-extraction, word-diff with `diff`, then judge.

- The unchanged case — the common case — costs one sub-second fetch and one D1 row.
- A page that cannot be read by `fetch` is marked `transport='browser'` on its `page` row and takes the browser path from then on.
- Two paths to keep honest, and a same-page comparison that must be immune to the noise a plain fetch carries.

## Screening

**I measured the thing that decides it.** Two fetches of `gymshark.com` five seconds apart, **2026-09-21 12:15:40Z**:

- identical length, 1,608,007 bytes both times;
- **different raw sha256** — `a865bdf16608abde…` vs `7bae93a10827fd8a…`;
- an **exhaustive** character-level diff of the whole 1.6 MB document (`difflib.SequenceMatcher`, `autojunk=False`) found **exactly four replacements and nothing else**, all inside the feature-flag block of `__NEXT_DATA__`, on the flags `ecom.web.plp.tabbed.link.cards` and `ecom.web.mss.allstores`:

```
A: …tabbed.link.cards","enabled":true,"variant":{"name":"gs-test_web_t127.1","enabled":true}…
B: …tabbed.link.cards","enabled":true,"variant":{"name":"gs-test_web_t127.0","enabled":true}…
A: …web.mss.allstores","enabled":true,"variant":{"name":"gs-test_web_t143.0","enabled":true}…
B: …web.mss.allstores","enabled":true,"variant":{"name":"gs-test_web_t143.1","enabled":true}…
```

— A/B-test bucket assignments, re-rolled per request. Not a sample: the whole document was compared, and there is no other difference anywhere in it;

- and **extracted visible text identical**: 14,814 characters, sha `f7be8377d65cf6d4…` both times.

`0509.io`'s own homepage also differs byte-for-byte between two immediate fetches.

That kills the framing that Candidate A is the simpler shape. **Any hash over raw bytes — from a fetch or from a browser — fires on every single tick**, so A would take a screenshot and call Jev for every page every day and find nothing. A's simplicity only exists if it hashes extracted text, which is precisely B's mechanism. Once both shapes hash extracted text, the only difference left is who pays for the unchanged case, and that is a 10× cost difference.

**Where A is genuinely better:** a marketing site that renders its copy only in JS. A plain fetch returns a shell and the engine would see "no change" forever — the worst failure available, because it is silent.

**Where both are equal:** the diff, the judgment, the storage, the marks. Nothing downstream of extraction cares which transport produced the text.

## Decision

**Candidate B wins, on measured cost**, with A's failure mode closed by the graft.

**Grafted from A:**

1. **Transport is learned per page, once.** If a plain fetch yields under 200 characters of extracted text, or a non-2xx, or a challenge body, the `page` row is marked `transport='browser'` and every later tick uses the browser for that page. Re-tested weekly, because sites change stacks. A page that renders in JS is therefore browser-rendered from its second tick, not forever misread.
2. **The hash is over normalised extracted text, never over bytes or the DOM.** Normalisation: collapse whitespace, drop `<script>`, `<style>`, `<noscript>`, drop elements marked `aria-hidden`. Measured above to be stable across requests where the raw bytes are not.
3. **The screenshot pair is evidence, not the detector.** Screenshots are captured only after the text hash has already said something changed.

**Rejected, recorded so it is not re-litigated:**

- **`pixelmatch` 7.2.0 as the diff mechanism**, which #3879's packet named. A pixel diff on a marketing page is dominated by carousels, lazy images, and exactly the A/B variants measured above — the same noise class, rendered instead of serialised. Screenshots stay as evidence for the before-and-after marks; the detector is text. If a genuinely visual change ever needs detecting (a layout break), that is a new decision with its own evidence.
- **`html-to-text` 10.0.1**, which #3879's packet also named, superseded by `HTMLRewriter` per `REBUILD-STACK.md` §5.1: 46.4 KB gzip to get word-wrapping and list bullets that a diff does not want, versus a platform primitive at zero bytes that never materialises a DOM.
- **Browser-first**, as above: 26.7 browser-hours a month against a 10-hour allotment, to detect nothing on most pages.

---

## Live probes

| # | Upstream | Call | Result |
|---|---|---|---|
| 1 | Competitor homepage | `GET https://www.gymshark.com/` | **200**, 1,608,007 B, **1.07 s**, at **12:12:39Z**; 14,814 characters of extracted visible text |
| 2 | Same page, second fetch 5 s later | `GET https://www.gymshark.com/` | **200**, same length, **different raw hash, identical text hash** — the churn measurement above, at **12:15:40Z** |
| 3 | Competitor pricing-role page | `GET https://www.gymshark.com/collections/all-products` | **200**, 1,836,099 B, **0.84 s**, at **12:13:27Z** |
| 4 | **Own site** | `GET https://0509.io/` | **200**, 84,209 B, **1.10 s**, at **12:13:26Z**; raw hash differs between two immediate fetches |
| 5 | Own site health | `GET https://0509.io/api/health` | **200** `{"status":"ok","app":"0509"}` (per `REBUILD-KEEPLIST.md`, re-checked live) |
| 6 | Browser Rendering REST | `POST /accounts/<id>/browser-rendering/markdown` | **401 Authentication error** at **12:15:10Z** and **12:15:20Z** — both host tokens lack the scope; the `/user/tokens/verify` call on the same token returned **200** (`id 1bfdb479e69ca9e9393c43111f75ca51`), so the token is live and simply not permitted |
| 7 | Browser Rendering **in production** | `GET https://0509.io/search?website=gymshark.com` | **200**, 134,877 B, **15.55 s**, `data-f9-result-source="meta_library_browser"`, at **12:13:25Z** — the deployed Worker's browser leg reaching a host that returns **403** to this VPS's own fetch |
| 8 | Jev, D9 shape | `POST 127.0.0.1:4000/jev` | **200**, **0.33 s**, at **12:19:10Z** |

**Probe 8, verbatim** — the page-role judgment this engine's schedule depends on:

```json
// request
{"state":{"subject":{"name":"Gymshark","domain":"gymshark.com"},
          "page":{"url":"https://www.gymshark.com/collections/all-products","title":"All Products | Gymshark"}},
 "questions":{"page_role":{"type":"choice",
   "instructions":"What role does this page play for the subject brand?",
   "criteria":{"home":"the brand homepage","pricing":"plans, prices or a shop listing with prices",
               "product":"a single product or feature page","blog":"editorial or news",
               "careers":"jobs","legal":"terms, privacy","other":"anything else"}}}}
// 200, 0.33 s
{"answers":{"page_role":{"type":"choice","choice":"pricing",
   "probabilities":{"pricing":0.81,"other":0.16,"product":0.02,"home":0.01,"blog":0,"careers":0,"legal":0}}},
 "providerMetadata":{"typesafe":{"confidence":{"page_role":0.78}}},
 "usage":{"inputTokens":462,"outputTokens":68}}
```

A URL regex would have filed `/collections/all-products` as `other` and never snapshotted it on the pricing cadence. That is `REBUILD-JEV.md`'s D9 rule — "`/plans`, `/membership`, `/tarifs` are pricing pages; a regex would miss them" — confirmed on a real page.

### Findings

1. **The raw-HTML hash is unusable as a change detector on real brand sites.** Measured above. This is the single most important fact in this engine and it is the reason the hash gate is specified over extracted text everywhere in these packets.
2. **Browser Rendering cannot be proven from this host or from CI as things stand** (probe 6). The binding needs no token, so production is unaffected, but a packet's browser proof must run against the deployed Worker. A token with **Browser Rendering: Edit** would let CI prove it directly — Nish's to mint, and worth it.
3. **`REBUILD-KEEPLIST.md` finding 6 is not contradicted by probe 1.** The keep-list recorded `gymshark.com` answering `curl` and refusing workerd; my fetch from this VPS also succeeded, with and without a browser UA. Those are consistent — the gate is on workerd's fetch signature, not on this IP. The design does not depend on which is true: the escalation triggers on the symptom (non-2xx, challenge, or too little text), so a workerd refusal is handled without anyone re-deriving why.

---

## Data flow against the schema

| Step | Reads | Writes |
|---|---|---|
| Select | `watch JOIN entity WHERE entity.state='on' AND source.kind='site'`, `page` (role, transport) | — |
| Fetch | `page.transport` | — |
| Extract + hash | — | — |
| Unchanged | previous `snapshot.payload_hash` | **one `snapshot` row**: `payload_r2_key`, `payload_hash`, `item_count`, `fetched_at`. Nothing else. No screenshot, no Jev, no signal |
| Changed | the previous snapshot's R2 body | R2: new text body + **screenshot pair**; one `snapshot` row |
| Diff | both bodies | the diff hunks stored in R2 alongside, referenced by key |
| Judge | `entity`, `signal` history, `user_decision` | `jev_verdict` (D3s first for self, then D3) |
| Publish | — | `signal`, `kind='change'` — the conditional CHECK requires `aspect`; the `change` view reads it |
| Own-site break | — | `alert` immediately, plus `send_attempt` through the Email Service binding |
| User says "I meant to do that" | — | `user_decision`, keyed to the signal — this is the `user_memory` every later judgment reads |

**One snapshot row per watch per tick, always. Signal rows only for changes that survived judgment.** That is the schema's chosen shape and the reason this engine cannot reproduce the 2026-09-17 rows-written bill.

## Workflow / Queue / cron layout

Two crons, one Workflow class, the same two queues as every other engine.

```
cron "0 3 * * *"          competitors, daily
cron "0 * * * *"          self entities only, hourly — home + checkout/pricing pages
  └─ SiteSweepWorkflow(scope: 'competitors' | 'self')
       step.do("select")   → (watch, page) pairs; self scope takes only role in {home, pricing}
       step.do("enqueue")  → sendBatch in chunks of 100
                               page.transport='browser' → page-sweep   (max_concurrency 8)
                               page.transport='fetch'   → fetch-sweep  (max_concurrency 20)
       step.sleep("settle", competitors "30 minutes" | self "5 minutes")
       step.do("assert")   → coverage from snapshot rows for this tick; re-enqueue the missing once
       step.do("escalate") → still short: prioritise ON brands' home + pricing, mark the rest
                             degraded, record the measured sweep time and queue depth for Nish
```

The consumer, per message: fetch (or render) → extract → normalise → hash → compare. On a hash match it writes the snapshot row and stops. On a mismatch it escalates to a browser for the screenshot pair, word-diffs with `diff` **9.0.0**, calls D3s (self) or D3, and writes.

**Budgets, as numbers.** At most **4 browser escalations per brand per day** and **6 Jev judgments per brand per day**, counted in a **Durable Object** keyed by workspace-and-day — not KV, whose 1-write-per-second same-key limit and 10×-read write price make it the wrong store for a counter (`REBUILD-STACK.md` §4.5). Exceeding a budget marks the item `unreviewed` and defers it; it never silently skips.

**The browser cap is one number in one place**: `page-sweep`'s `max_concurrency: 8`, plus the 2 slots reserved for interactive onboarding, against `BROWSER_CONCURRENCY_CAP = 10` in `wrangler.jsonc` vars. Ads and site-change share that single capped consumer, which is what makes the total enforceable rather than aspirational. If the sweep cannot finish inside its window at the cap, the `escalate` step protects ON brands' home and pricing pages first and hands Nish a measured number the same day, per his standing rule of 2026-09-21. Brands are never dropped silently.

Steps: 5 per instance; 1 competitor instance a day plus 24 self instances = **125 steps a day**, 3,750 a month, against 500,000 included.

## Jev decisions used

| Id | Primitive | When | Context pack fields |
|---|---|---|---|
| **D9** `page_role` | Choice | once per discovered page, again only when the title hash changes; cached on `page.role_decided_for_hash` | `subject`, `item` = URL + title. Proven live above |
| **D3s** `own_site_breakage` | Noul | **every** own-site diff, before D3 | `self`, `subject` (= self), `item` = the diff hunks plus the code-computed evidence (HTTP status, text-length delta, sections present yesterday and missing today, price tokens vanished, checkout link resolving), `history_30d`, `user_memory` = the user's "I meant to do that" marks |
| **D3** `noteworthy_change` | Noul + Choice `kind` (offer / pricing / copy / launch / removal / breakage / unintended / noise) | every competitor diff, and own-site diffs that D3s cleared | `self`, `subject`, `item` = the diff hunks and the page role — **never full pages**, `history_30d` = the previous snapshot summary and the last 30 days of changes, `user_memory`, `reliability` |
| **D4** `read_this_first` | Noul + Score | weekly, over items that passed D3 | as the contract defines |

Thresholds, exactly as `REBUILD-JEV.md` fixes them: D3 publishes at p ≥ 0.9, discards and logs at p ≤ 0.1, publishes low and marked "possibly" between. **D3s is the one decision with a different bar — p ≥ 0.5 alerts immediately**, because a false alarm costs ten seconds and silence on a broken site costs the customer; below 0.1 it is treated as deliberate and handed to D3; between, the alert says "check this".

**What code decides, not Jev:** the HTTP status, whether a section is absent, whether a price token disappeared, whether the text length dropped by more than half. Those have ground truth, so they are computed and handed to D3s as **evidence**. Jev answers only "does this look broken or unintended", which is the part with no ground truth.

## Cost line

Per 1,000 page checks, priced from `REBUILD-COST.md` (2026-09-21):

| Leg | Units | Per 1,000 checks |
|---|---|---|
| Unchanged page (fetch + extract + hash) — the common case | 1 subrequest, ~1.1 s wall, negligible CPU | free |
| Changed page (escalation: 1 render + 1 screenshot ≈ 8 browser-seconds) | browser-seconds | at a 10% change rate: 100 × 8 s = **0.22 browser-hours** → **$0.02** |
| D1 | 1 snapshot row per check + 1 signal row per published change | 1,000 + ~50 = **1,050 rows written** — 0.002% of the 50M included |
| R2 | 1 text PUT per check + 2 screenshot PUTs per change | 1,200 Class A (**$0.005**), ~1 GB-mo (**$0.015**) |
| Queue | 3 ops per check | 3,000 — **$0.0012** |
| Jev | ~100 calls (changes only) | $0 on the seat, **$0.0016** at the measured market rate |

**Monthly at 100 brands**, 4 pages each daily plus one hourly self page per workspace:

- Checks: 100 × 4 × 30 = 12,000 competitor + 100 × 24 × 30 = 72,000 self = **84,000 checks**.
- Browser, at a 10% change rate and the 4-per-brand-per-day cap: ~8,400 escalations × 8 s = **18.7 browser-hours** → 8.7 h beyond the allotment → **$0.78/month**.
- D1: **84,000 snapshot rows** + ~4,200 signal rows = 88,200 rows written — **0.18% of the 50M included** → **$0.00**.
- R2: ~101,000 Class A ops → **$0.45**; ~20 GB under the 1-year retention guardrail → **$0.30/month**, falling to the marks-only figure after the lifecycle rule expires the raw bodies.
- Queues: 252,000 ops → **$0.10**.
- Jev: ~8,400 calls → **$0 on the seat**, $0.13 at market.

**Total Cloudflare cost at 100 brands: about $1.63 a month**, the largest single engine bill in the product and still a rounding error against the $5 Workers Paid base.

**Two numbers to state plainly.** Browser-first (Candidate A) would have been **26.7 browser-hours a month before any change was found**, or **$1.50/month** in duration alone plus a sweep that cannot fit in the cap's window. And the hourly self cadence is the expensive half of the check count (72,000 of 84,000): if the browser bill ever matters, the lever is the self cadence, not the competitor one.

## Failure modes and the degraded state the UI shows

| Failure | Detection | What the user sees |
|---|---|---|
| Page renders copy only in JS | extracted text under 200 chars | the `page` row flips to `transport='browser'` and the next tick renders it. Until then the page shows "we're still reading this page" — never a false "no changes" |
| Site blocks us entirely, both transports | non-2xx or challenge on both | that brand's site tracking shows **degraded** with the date it last succeeded. Rate limits come from the `source` row; we never retry harder (`REBUILD-GUARDRAILS.md`) |
| Change is real but noise | D3 `kind='noise'` or p ≤ 0.1 | nothing in the feed; the verdict is still logged, so "why didn't you show me this" is answerable |
| Change is ambiguous | 0.1 < p < 0.9 | published low, marked "possibly", with Jev's one-line reason |
| **Own site looks broken** | D3s p ≥ 0.5 | an Alerts entry within one Workflow tick — at most an hour old — plus an email through the Email Service binding, with the before-and-after screenshots and the specific evidence (status code, missing section, vanished price) |
| Own site changed on purpose | the user taps "I meant to do that" | a `user_decision` row; the same change never alerts again, and the mark feeds `user_memory` on every later judgment |
| Browser budget exhausted for a brand | the DO counter | changed pages are queued for the next tick and the page shows "checking this next" with the real next-tick time. Never dropped, never silently skipped |
| Sweep overruns its window at the cap | the `assert` step's coverage count | ON brands' home and pricing pages stay current; long-tail pages show their real last-checked time. Nish gets the measured wall clock and a proposed cap the same day |
| Screenshot missing for a published change | R2 key absent | the mark shows with the text diff and a "screenshot unavailable" line — a mark is never suppressed because its picture failed |

---

## PACKETS

### P1 — extraction, normalisation and the hash gate

**GOAL.** `extractPageText(html) → { text, hash, charCount }` where the hash is stable across repeated fetches of an unchanged page, and `hasChanged(prevHash, nextHash)`.

**STOCK FEATURE OR LIBRARY.** `HTMLRewriter` (platform, `REBUILD-STACK.md` §5.1) — drop `script`, `style`, `noscript` and `aria-hidden` subtrees, accumulate `text()` chunks until `lastInTextNode`, collapse whitespace. `crypto.subtle.digest('SHA-256', …)` (platform).

**FILES IN SCOPE.** `app/lib/site/extract-text.ts`, `tests/unit/site/extract-text.test.ts`, `tests/fixtures/gymshark-2026-09-21-a.html`, `tests/fixtures/gymshark-2026-09-21-b.html`.

**FORBIDDEN.** `html-to-text`, `cheerio`, `jsdom`, `linkedom` — rejected with reasons in the stack doc. Hashing raw bytes or the DOM. Concatenating `text()` chunks without the `lastInTextNode` check. Any hand-rolled tag stripper with a regex.

**PROOF REQUIRED.** The two committed fixtures are the real pair measured on 2026-09-21 at 12:15:40Z: **different raw sha256, identical extracted text (14,814 chars)**. The test asserts exactly that — raw hashes differ, text hashes match — and a third fixture with one real copy change asserts the hash moves. This test is the engine's whole premise; it must fail loudly if extraction regresses.

**PUSH.** Branch within 5 minutes; `git push -f origin HEAD:refs/heads/wip/issue-3879-p1` after every slice.

**COST.** Pure computation on a body already fetched. Zero.

### P2 — the per-page transport with learned escalation

**GOAL.** `readPage(page, env) → { html, transport, status, ms, browserMsUsed? }`: plain fetch first, escalate to Browser Rendering on non-2xx, a challenge body, or under 200 extracted characters; persist the learned transport on the `page` row and re-test it weekly.

**STOCK FEATURE OR LIBRARY.** The shared transport module from the identity engine's P3 (`env.BROWSER.quickAction`), `@cloudflare/puppeteer` **1.4.0** only where a wait-for selector is needed, with `sessions()` → `connect()` → `disconnect()`. Durable Object budget counter for escalations per brand per day.

**FILES IN SCOPE.** `app/lib/site/read-page.ts`, `workers/budget-counter.ts`, `tests/integration/site/read-page.test.ts`.

**FORBIDDEN.** `browser.close()`. Opening a browser outside the `page-sweep` consumer. A KV counter for the budget. Escalating without recording why. Retrying a refused page inside the same tick.

**PROOF REQUIRED.** From the deployed Worker: one real page served by `fetch` and one served by the escalation, each with status, ms and `X-Browser-Ms-Used`. **The bot-gating check #3879 asks for, run properly:** both responses for the same URL side by side — the workerd `fetch` result and the Browser Rendering result — with timestamps. The budget shown refusing a fifth escalation in a day and deferring the page rather than dropping it.

**PUSH.** `wip/issue-3879-p2`.

**COST.** ~8 browser-seconds per escalation, capped at 4 per brand per day. State the measured per-escalation figure.

### P3 — the diff and the before-and-after mark

**GOAL.** Word-level diff of two extracted texts into stored hunks with their page position, plus the screenshot pair captured at escalation time, all in R2 and referenced by key.

**STOCK FEATURE OR LIBRARY.** `diff` (jsdiff) **9.0.0** — `diffWords` for copy, `structuredPatch` for the stored hunks (8.3 KB gzip, 0 dependencies, `REBUILD-STACK.md` §5.2). Browser Rendering `/screenshot` with an explicit viewport. R2 binding.

**FILES IN SCOPE.** `app/lib/site/diff.ts`, `app/lib/site/marks.ts`, `tests/unit/site/diff.test.ts`.

**FORBIDDEN.** `pixelmatch` — rejected above with the measurement behind it; screenshots are evidence, not the detector. `fast-diff` and `diff-match-patch` (character-level, no structured hunks — rejected in the stack doc). Base64ing a screenshot into a D1 row. Returning a diff body from a Workflow step instead of an R2 key (1 MiB step-output cap). Diffing before the hash gate has said something changed.

**PROOF REQUIRED.** One real competitor change end to end: both snapshot row ids, the R2 keys for both texts and both screenshots, and the stored hunks, cited with timestamps. One unchanged tick shown producing **one snapshot row and nothing else** — no screenshot, no diff, no Jev call.

**PUSH.** `wip/issue-3879-p3`.

**COST.** 2 screenshot PUTs plus 1 text PUT per change. State R2 Class A ops per 1,000 checks.

### P4 — judgment: D3s then D3

**GOAL.** Compute the ground-truth breakage evidence in code, run D3s on every own-site diff and D3 on the rest, apply the thresholds exactly, and log every verdict.

**STOCK FEATURE OR LIBRARY.** The Jev client from the identity engine's P4 (`questions` record; `boolean` for the Nouls, `choice` with `criteria` for D3's `kind`). D1 `batch()`.

**FILES IN SCOPE.** `app/lib/site/breakage-evidence.ts`, `app/lib/site/judge.ts`, `tests/integration/site/judge.test.ts`.

**FORBIDDEN.** Asking Jev anything with a ground truth — status codes, counts, whether a section is present, date maths (`REBUILD-JEV.md`). Sending full pages instead of hunks. Acting on a verdict in the uncertain band. Running D3 before D3s on a self diff. Skipping the `jev_verdict` row for a verdict that resulted in no action.

**PROOF REQUIRED.** On real records: one competitor change with `question_id`, `input_hash`, p, reason, the chosen `kind` and the action; one **own-site** break with its D3s probability and the code-computed evidence that accompanied it; one verdict in `0.1 < p < 0.9` shown marked uncertain, ranked low and **not** auto-applied; one repeat of an identical judgment shown served from the cached verdict (`UNIQUE(question_id, input_hash)`) with no second call.

**PUSH.** `wip/issue-3879-p4`.

**COST.** ≤6 Jev calls per brand per day. Measured: 380 input / 23 output tokens per call, $0 on the seat, $0.00001596 at market.

### P5 — the sweep Workflow, both crons, and coverage assertion

**GOAL.** `SiteSweepWorkflow` in both scopes, the daily competitor cron and the hourly self cron, the two queue consumers with DLQs, and the coverage assertion that makes a silent source impossible.

**STOCK FEATURE OR LIBRARY.** Workflows (`step.do` with `{ retries: { limit: 3, backoff: "exponential" } }`, `step.sleep`), Queues (`max_concurrency`, `dead_letter_queue`, `max_retries: 3`), Cron Triggers, D1 `batch()`.

**FILES IN SCOPE.** `workers/site-sweep-workflow.ts`, `workers/queue-consumers.ts`, `workers/schedule.ts`, `wrangler.jsonc`, `tests/integration/site/sweep.test.ts`.

**FORBIDDEN.** Work inline in `scheduled()`. `setTimeout` / `setInterval` — isolate lifetime makes them wrong. A `step.do` per page. `max_concurrency` above 8 on `page-sweep` without Nish's recorded yes and the $2/browser/month cost in the PR body. A queue without a DLQ. Commenting out the `crons` key to disable a job — documented not to work; set `crons: []`. Dropping a brand to fit the window.

**PROOF REQUIRED.** One real tick of each scope: instance id, enqueued count, covered count, at least one `step.do` retry visible in the run history, one message reaching the DLQ after its retries, and the `escalate` path exercised once with its measured wall clock and queue depth. A test that fails when coverage is asserted on the trigger instead of on snapshot rows — the keep-list's finding 3 encoded so it cannot recur.

**PUSH.** `wip/issue-3879-p5`.

**COST.** 5 steps per instance; 25 instances a day = 3,750 steps a month against 500,000 included.

### P6 — own-site alerts and the before-and-after surface

**GOAL.** The immediate own-site alert lane (D3s ≥ 0.5 → `alert` + email in the same tick), the "I meant to do that" action writing `user_decision`, and the before-and-after mark component used on both the competitor page and Alerts.

**STOCK FEATURE OR LIBRARY.** Cloudflare Email Service `send_email` binding (`REBUILD-STACK.md` §4.7) with one-click unsubscribe as shipped. React Router **8.4.0**, `shadcn` **4.21.0**, Tailwind **4.3.3** tokens.

**FILES IN SCOPE.** `app/lib/site/alerts.ts`, `app/components/before-after-mark.tsx`, `app/routes/alerts.tsx`, `e2e/own-site-alert.spec.ts`.

**FORBIDDEN.** Routing an own-site break through the weekly digest. A hand-rolled email sender or template engine. A legend anywhere on the mark — if it needs one, the design failed. Showing a mark without its source URL and captured-at time. Suppressing a mark because its screenshot is missing.

**PROOF REQUIRED.** A real own-site break — induced on a staging page, captured on production's own site — from diff to `alert` row to delivered email, with every id and timestamp, inside one Workflow tick. The "I meant to do that" action shown writing `user_decision` and the same change shown **not** alerting on the next tick. Playwright at 1440 and 390: no console errors, no horizontal scroll, both screenshots legible in the mark.

**PUSH.** `wip/issue-3879-p6`.

**COST.** Email: one send per incident, inside the Email Service tier. No browser beyond P2's escalation. State the per-incident D1 row count (one `alert`, one `send_attempt`).
