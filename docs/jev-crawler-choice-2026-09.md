# Jev shadow at the crawler choice points — 2026-09

Issue: Nishfleet/0509#3618 (epic Nishfleet/0509#3530). Method copied from
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast): build the
action space from the DOM in code, let Jev pick, generation only as a fallback.

**What shipped: measurement only. No crawler behaviour changed, nothing is wired into
production.** The helper exists and is tested; switch-on is gated by the epic #3530
conditions (see [Switch-on](#switch-on-not-done)).

## 1. Inventory — every decision point in the existing crawlers

`meta_library_browser` (Meta Ad Library), full-site watch, mention connectors. All
values are the committed constants; line numbers are on `origin/main` at the time of
this run.

| # | Choice point | File:line | Scripted today | Loop / fail risk |
|---|---|---|---|---|
| 1 | Meta interactive scroll pass | `app/lib/meta-library-browser.server.ts:530-565`, loop at `:537`; constants `:91-94` | Scroll to page bottom, wait 2s, re-extract. Another pass while `pass < 3` AND `cards < 50` AND `elapsed < 10s` | Bounded: 3 passes, 10s budget, 50-card target. **Not checked: whether the pass produced any new cards.** Two of three real runs scrolled when the page showed nothing new (see §4) |
| 2 | Meta API after-cursor | `app/lib/meta-library-browser.server.ts:96,363-364` | Follow the returned `after` cursor `INTERACTIVE_META_API_EXTRA_PAGES = 2` extra times | Bounded at 2. Cursor exhaustion is handled, but the count is fixed, not evidence-based |
| 3 | Meta surface ready / login wall | `app/lib/meta-library-browser.server.ts:1285-1330`; selector `:67-68` | `waitForLibrarySurface` polls for a result anchor or a login-wall string up to `PAGE_READY_TIMEOUT_MS = 8s` | Scripted timeout; a slow surface fails with `login_wall`/timeout rather than adapting |
| 4 | Full-site sitemap queue | `app/lib/competitor-site-monitor.server.ts:571-730`, drain at `:668`; `SITEMAP_DOCUMENT_LIMIT = 8` (`:80`) | Drain the queue, robots-declared first, conventional `/sitemap.xml` next, nested index entries appended | Bounded at 8 documents. No check of whether the next document added pages |
| 5 | Full-site BFS crawl frontier | `app/lib/competitor-site-monitor.server.ts:789-857`, loop at `:830`; `CRAWL_MAX_DEPTH = 3` (`:86`) | Expand the frontier while depth < 3 and budget remains | Bounded, deterministic. The budget is spent in link order, not by page value |
| 6 | Full-site page selection | `app/lib/competitor-site-monitor.server.ts:157-205`; `DEFAULT_PAGE_BUDGET = 50` (`:77`) | Hot/warm page-kind classes first (pricing, home, changelog, landing), then a deterministic rotating batch | Deterministic by URL sort; no per-page judgement |
| 7 | Mention-connector cursor | `app/lib/presence-connectors/bluesky.server.ts:38,226` (`MAX_PAGES = 2`); reddit `:35,193` (`limit: 100`); threads/website cursor in `presence_poll_cursor.cursor_json` | Same class as #2: bounded API-cursor pagination | Same as #2 — fixed page count, no evidence of new results |

Decision-point count: **7** (2 of them the same cursor-pagination class). The two
that actually carry a loop/fail risk today are #1 and #3; the rest are hard-bounded.

## 2. What was shadow-logged

At each choice point the candidates are the elements the code already enumerates,
plus `stop`:

- #1: the script's own branches (`scroll_pass`) plus every result-card anchor the
  code's `AD_LIBRARY_RESULT_SELECTOR` matches, plus `stop`.
- #2/#7: `follow_cursor` plus `stop`.
- #4: the queued sitemap documents plus `stop`.
- #5: the enumerated internal links plus `stop`.

One Jev `choice` question per point. The row shape matches the fleet helper so
Nishfleet/fleet-ops#7754 can score it:
`{ts, site, ref, state_sha256, answers, probabilities, usage, ms, choice_point,
page_url, scripted, scripted_reason, jev_choice, jev_confidence, agreed, candidates}`.

## 3. Run record

Real records only (no invented samples):

- Choice points 1-2 use the captured production DOM fixture
  `tests/fixtures/meta-ad-library-card-nykaa.logged-out.html` (real Ad Library card,
  captured 2026-09-09).
- Choice points 4-5 use a live sitemap and live link fetch of
  `https://www.cloudflare.com` (captured 2026-09-19).
- Every Jev call is on the live API (`typesafe-ai/jev`, model `jev-1.13.0`) through
  the Jev-only key; `state_sha256` per row pins the exact state.

Command:

```bash
set -a; . ~/.config/fleet-ops/seats/typesafe-jev.env; set +a
node scripts/bench/jev-crawler-choice-2026-09.mjs \
  --out docs/benchmarks/jev-crawler-choice-2026-09.jsonl
```

Result (15 rows, one file `docs/benchmarks/jev-crawler-choice-2026-09.jsonl`):

| Choice point | Rows | Agreed with script | Agreement |
|---|---:|---:|---:|
| `meta_library_scroll` | 3 | 1 | 0.33 |
| `meta_library_api_cursor` | 3 | 3 | 1.00 |
| `fullsite_sitemap_queue` | 1 | 1 | 1.00 |
| `fullsite_crawl_frontier` | 8 | 7 | 0.88 |
| **Total** | **15** | **12** | **0.80** |

Cost and latency (from the rows' own `usage`/`ms`): 9,361 input tokens, 1,450 output
tokens, p50 299 ms, max 791 ms. At the recorded TypeSafe list price
($0.042/MTok in, $0 out) the whole run cost **$0.00039**. Per-item: ~$0.000026 and
~0.3 s.

## 4. The cases where the script was wrong and Jev disagreed

Three disagreements, all with a scripted branch that kept going when Jev said stop or
change target:

1. **`meta_library_scroll` → Jev `stop` (p=0.72), script `scroll_pass`.**
   The page text showed a single card with no further content, so a second scroll
   pass cannot add anything. The script's loop condition (`pass < 3`) does not check
   whether the previous pass produced new cards — it scrolls regardless, burning a
   2s wait and a re-extraction. **This is a real wasted-work case.**
2. **`meta_library_scroll` → Jev `stop` (p=0.80), script `scroll_pass`.** Same shape,
   later pass. Jev's confidence rose on the repeated no-new-content state.
3. **`fullsite_crawl_frontier` → Jev `https://www.cloudflare.com/products/` (p=0.54),
   script `https://www.cloudflare.com/`.** The script spends its budget in link order;
   Jev preferred a higher-value product page over the homepage. A near-tie (0.54), so
   weak evidence — recorded, not acted on.

No case was found where the script **looped** or **failed** in a way Jev would have
prevented: every loop is hard-bounded. The actionable finding is the opposite — the
scroll loop **keeps going after the page stops producing cards**, and Jev detects that
at p=0.72-0.80.

## 5. Verdict

**Not-planned for switch-on now; the evidence is recorded.** A shadow, not a gate.
The measured agreement (80%) is too low and too small a sample (15 rows) to let Jev
drive a crawler, and the `meta_library_scroll` candidates in this run are not the
DOM enumeration a wired call site would pass (see Honest limits). The one useful
signal — a stop-check after a scroll pass yields no new cards — is a plain-code fix,
not a Jev feature, and is filed as its own issue.

Epic criterion "if there are none [cases where the script looped/failed while Jev's
pick differed], close as not-planned with the numbers": there **are** such cases (#1,
#2 in §4), so this stays open as measured evidence, not closed as not-planned.

## 6. Honest limits

- 15 rows across 4 points. Not a benchmark; no accuracy or calibration claim.
- The `meta_library_scroll` candidates are read from the single-card fixture, whose
  real result-card anchors are mostly absolute `facebook.com/ads/library/?id=` links.
  A wired call site would pass the live anchor list. Treat this point's 0.33 agreement
  as directional only.
- Only the first page of each live site was read; the crawler's deeper behaviour
  (repeated passes, budget exhaustion) was not reproduced.
- One `fullsite_sitemap_queue` row (the live site declares one sitemap). Too few to
  read.
- Jev's `stop` probability is not threshold-ready: no measured precision/recall on
  this domain (the epic #3530 benchmark already found Jev no-go for production gates).

## 7. Switch-on (not done)

The epic #3530 scope note (2026-09-18) requires two things before any production
call. Status:

1. **Log the fleet-helper row shape** — done: `state_sha256` and the full row are in
   `app/lib/crawler-choice-jev.server.ts`, so fleet-ops#7754 can score it.
2. **Cloudflare per-token Jev price, from the dashboard, in the PR body** — the
   TypeSafe list price is on the public API page ($0.042/MTok in, $0 out); the
   Cloudflare AI-gateway price is not on the public doc page and needs the dashboard.
   Recorded in the PR body, and no production call happens until it is.

Client for any future wiring is the Workers binding `env.AI.run("typesafe/jev", …)`;
the helper takes a structural `CrawlerChoiceAi` and swallows every failure, so a
wired call site can never change crawl behaviour.

## 8. Follow-ups

- Filed: the Meta scroll loop should skip a pass when the previous pass added no new
  cards (`collectCardsWithInteractiveScroll`). Plain code, no Jev.
