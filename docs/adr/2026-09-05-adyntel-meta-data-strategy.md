# ADR: Adyntel integration evaluation — build vs buy for Meta Ad Library data

- **Status:** PROPOSED — awaiting owner decision (money + legal)
- **Date:** 2026-09-05
- **Tracking issue:** [#1560 — Adyntel integration evaluation](https://github.com/Nishfleet/0509/issues/1560)
- **Decision owner:** Nish (money + legal; not delegable to a worker)
- **Scope:** the raw Meta Ad Library data feed that powers `/search`, the
  monitoring pipeline, `/ads/:domain` pages, and every downstream feature.
- **Out of scope:** resolving Meta Page IDs for specific domains (#1396), the
  slack.com/tcs.com dead-ends (#1269). Those are tactical; this is the
  strategic source-of-truth decision for the whole Meta data pipeline.

## Context

The Meta Ad Library is the single source of raw ad creative data for the
product. Every customer-facing surface — search preview, monitoring alerts,
`/ads/:domain` pages, digest briefs — depends on it. Today 0509 owns the
pipeline that fetches it. The build-vs-buy decision for that feed is unmade
and undocumented, which means a single point of failure with no recorded
rationale and no fallback plan.

### What the research found (2026-09-02, §2.4 and §3.7)

- **The official Meta Ad Library API returns commercial ads only where they
  were delivered to the EU/UK.** Everywhere else it serves political and
  social-issue ads only. Global commercial coverage is not available through
  the official API.
- **Global commercial coverage therefore means scraping the Ad Library UI:**
  CAPTCHA-gated, IP-blocked, ToS-adverse, structurally fragile. Verified
  independently — `facebook.com/ads/library?q=nykaa` returns HTTP 403 to a
  plain client.
- **Adyntel is a supplier, not a competitor** — an ad-intelligence API at
  $44 / 5,000 credits (~$0.0098 each), $179 / 25,000, $321 / 50,000, 50 free
  credits, no card. It sells the same Meta ad data as an API, taking on the
  scraping and the ToS risk.
- **Index size is a fight with Meta's anti-bot team, not a product strategy.**
  Foreplay / AdSpy / adlibrary.com have already paid for that index; 0509 will
  not out-index them. But the same constraint creates the moat: *continuous
  capture is the only way to own history.*
- Research §3.7 flagged this explicitly as `[NISH]`: "Build-vs-buy here is
  money and legal."

### Current state — owned scraping pipeline

The raw feed today is `app/lib/meta-library-browser.server.ts` (~2,500 lines)
driving a Cloudflare Workers Browser binding (`@cloudflare/puppeteer`) against
the live Ad Library UI. Key facts verified in the repo:

- **Mechanism:** headless Chromium navigates `facebook.com/ads/library`,
  renders the page, and `parseRenderedMetaLibraryHtml` extracts ad cards from
  the rendered HTML. It is a UI scraper, not an API client.
- **Fragility is structural, not incidental.** The pipeline depends on Meta's
  DOM staying stable, on Meta not blocking the browser's IP/account, and on
  CAPTCHA not appearing. A 403 to a plain client is already the documented
  baseline behaviour. Every Meta UI change is a potential outage.
- **Cost today is infra + engineering, not per-call.** The Browser binding is
  billed by Cloudflare (browser sessions are the expensive Workers resource),
  plus the engineering time to keep the parser alive against Meta's UI churn.
  There is no per-ad-fetch line item, but there is a continuous maintenance
  tax and a latent ToS exposure that lives on 0509.
- **The moat is the longitudinal layer, not the raw fetch.** `landing_page_snapshot`
  (from migration `0001_app.sql`, with a backfill in `0081`; the `discovery_*`
  tables in `0008` wrap the raw-ingestion path) stores captured history.
  Whoever provides the raw ad
  data, 0509 owns the timeline of what changed and when. That is the product.
- **Check frequency is plan-tiered:** free = weekly, paid = every 3–6 hours
  (`watchlist-route-actions.server.ts`, `market-desk-brief.ts`). The volume
  math in the cost projection below uses the paid cadence.

## Option A — Continue owning the scraping pipeline

Invest in hardening the owned pipeline rather than buying the raw feed.

**What it means:**

- Residential proxy rotation to dodge IP blocks.
- CAPTCHA-solving service integration (third-party, its own cost and ToS).
- Parser resilience work on every Meta UI change (an open-ended maintenance
  commitment).
- Keep the ToS risk on 0509: scraping the Ad Library UI is against Meta's
  Terms. The risk is enforcement (blocks, legal cease-and-desist), not a fine
  today, but it is a real exposure that grows with scale.

**Cost projection (Option A):**

| Line item | Estimate |
|---|---|
| Cloudflare Browser binding sessions | already in the bill; scales with check volume |
| Residential proxies | ~$50–$300/mo depending on volume and provider |
| CAPTCHA solver | ~$20–$150/mo (per-1k solves) |
| Engineering maintenance | the dominant hidden cost — unbounded, reactive to Meta UI churn |

The engineering line is the real one. It is not a fixed subscription; it is
"every time Meta ships a UI change, the pipeline breaks and someone fixes
it." At scale that is a standing headcount tax, not a line item.

**SLA (Option A):**

- No external SLA. Uptime is whatever 0509 can keep the scraper alive for.
- Empirically fragile: a single Meta DOM change or IP block degrades the whole
  feed. Mean time to detect is fast (canaries), mean time to repair is
  "whenever an engineer ships a parser fix."
- No contractual recourse when it breaks.

**ToS risk (Option A):**

- Stays on 0509. Scraping the Ad Library UI is ToS-adverse. Enforcement risk
  is low today (Meta mostly blocks rather than sues) but non-zero and
  scales with visibility. This is a legal exposure Nish owns.

**Moat preservation (Option A):**

- Fully preserved. 0509 owns the raw fetch and the longitudinal layer
  end-to-end. No third party can cut off the feed by going out of business or
  changing terms — only Meta can, by blocking the scraper.

**Fallback (Option A):**

- None by design. If the owned pipeline cannot be kept alive (Meta blocks
  become persistent, CAPTCHA becomes unsolvable at viable cost), there is no
  second source wired in. The fallback is "build the Adyntel integration
  under duress," which is the worst time to do it.

## Option B — Adopt Adyntel as the raw feed, keep the longitudinal moat

Buy the raw ad data from Adyntel's API; keep 0509's longitudinal capture,
change detection, alerts, and proof layer as the product.

**What it means:**

- Migrate search v2 and monitoring ingestion to call Adyntel's API instead of
  driving the browser scraper.
- The browser scraper is retained (initially dual-write, later decommissioned)
  as the fallback path — see Fallback below.
- 0509 still owns `landing_page_snapshot`, the change-detection diffing, the
  alert pipeline, and every customer-facing surface. Only the raw ad fetch
  moves to Adyntel.

**Cost projection (Option B):**

The issue's scale assumption: 1,000 watchlists × 24 checks/day × ~50 ads/check
= 1.2M ad fetches/month.

| Adyntel tier | Credits | Price | $/credit | Cost at 1.2M fetches/mo |
|---|---|---|---|---|
| Starter | 5,000 | $44 | $0.0088 | ~$10,560/mo |
| Mid | 25,000 | $179 | $0.00716 | ~$8,592/mo |
| Bulk | 50,000 | $321 | $0.00642 | ~$7,704/mo |

So at the issue's stated scale, Adyntel is roughly **$8k–$11k/mo** in raw API
spend. The per-credit cost drops with bulk tiers; the ~$0.0098/credit figure
in the research is the starter tier, the worst case.

**Important caveats on this number:**

- 1.2M fetches/mo assumes 1,000 *paid* watchlists at the highest cadence.
  Today's volume is far lower. The real near-term bill is much smaller and
  grows linearly with paid usage — it is a variable cost that tracks revenue,
  not a fixed overhead.
- One Adyntel "credit" may map to one ad fetch, one search, or one enriched
  record — the exact unit must be confirmed against Adyntel's API docs before
  any commitment (this is a blocking question for the migration epic, not for
  this ADR).
- 50 free credits exist for a proof-of-concept at zero cost.

**SLA (Option B):**

- Adyntel is a single supplier. Its SLA terms must be read from its API/terms
  docs before commitment (blocking question for the migration epic). Until
  read, treat the SLA as "best effort, no contract" — which is no worse than
  Option A's "no SLA at all," and likely better because Adyntel's core
  business is keeping that API up.
- 0509's customer-facing SLA does not change either way — it is whatever
  0509 promises customers, fed by whichever raw source.

**ToS risk (Option B):**

- Moves to Adyntel. 0509 consumes a commercial API; the scraping ToS exposure
  is Adyntel's, not 0509's. This is the single largest non-financial benefit
  of Option B: 0509 stops being the party scraping Meta.
- New risk: 0509 becomes dependent on Adyntel's ToS (price changes, service
  discontinuation, data-use restrictions). Mitigated by the fallback path and
  by the fact that Adyntel is a supplier many tools rely on, not a single
  point of failure unique to 0509.

**Moat preservation (Option B):**

- Preserved. The moat is the longitudinal layer (`landing_page_snapshot`,
  change detection, proof alerts), not the raw fetch. Switching the raw
  source does not touch the moat. The north-star rule holds: *whoever
  provides the raw feed, 0509 must own the longitudinal layer.* Option B
  honours that explicitly by keeping the snapshot/diff/alert pipeline in
  house.

**Fallback (Option B):**

- The owned browser scraper is kept as a failover. The migration is
  dual-write → cutover → keep-scraped-fallback-warm (not full decommission),
  precisely so that an Adyntel outage or deprecation can fail back to the
  owned pipeline. This is the inverse of Option A's "no fallback by design."
- The fallback scraper can be run at low cadence (cheap) just to keep the
  parser alive against Meta UI drift, so it is not a cold start when needed.

## Cost comparison at a glance

| | Option A (own) | Option B (Adyntel) |
|---|---|---|
| Raw feed cost | infra + proxies + CAPTCHA solver (~$70–$450/mo) + unbounded engineering | ~$8k–$11k/mo at 1.2M fetches; near-term far less; scales with paid usage |
| Engineering tax | high, reactive, open-ended | low — integrate once, maintain the longitudinal layer |
| SLA | none (best-effort) | supplier SLA (TBD from docs; likely better than none) |
| ToS risk | on 0509 | on Adyntel |
| Moat | fully owned | fully owned (unchanged) |
| Fallback | none by design | owned scraper kept warm as failover |

## Recommendation

**Option B, phased, with the owned scraper retained as fallback.**

Reasoning, plainly:

- The moat is the longitudinal layer, and Option B does not touch it. The
  thing that makes 0509 hard to copy is the history, not the act of fetching
  ads from Meta. Buying the fetch does not buy away the moat.
- The ToS risk moving off 0509 is worth more than the API bill. Scraping Meta
  is a legal exposure Nish carries personally; Adyntel carries it instead.
- The engineering tax of Option A is unbounded and reactive. Option B turns a
  unpredictable maintenance burden into a variable cost that tracks paid
  usage.
- The fallback path is symmetric: Option B can fail back to the owned scraper;
  Option A has no fallback at all. Keeping the scraper warm at low cadence is
  cheap insurance.
- The cost number that looks large (~$8–11k/mo) only materialises at 1,000
  paid watchlists on the highest cadence — i.e. at revenue that already
  covers it. Near-term the bill is small and grows with the business.

The recommendation is **not** a decision. It is the worker's analysis for
Nish to accept, reject, or modify. Money and legal are his alone.

## Decision:

**PENDING — owner decision required (money + legal).** Nish to choose Option
A, Option B, or a hybrid, and to clear the blocking questions below. Until
then the owned scraping pipeline remains the live raw feed and no migration
work begins.

## Blocking questions for Nish

1. **Option A, Option B, or hybrid?** (Hybrid example: Adyntel for global
   commercial, owned scraper for EU/UK where the official API is allowed —
   though the official API is not currently wired either.)
2. **Budget ceiling for Adyntel spend** at which the decision flips back to
   owned scraping.
3. **Acceptance of the ToS shift** — Option B moves scraping liability to
   Adyntel but creates supplier dependency. Is that trade acceptable?
4. **Confidence in the 1.2M-fetches/mo volume model** — is that the target
   scale, or a placeholder? The real near-term bill depends on this.

## Follow-up epics (created only after Nish decides)

- **If Option B:** a migration epic with phases —
  1. dual-write (Adyntel + owned scraper run in parallel, compare results),
  2. read cutover (search v2 and monitoring read from Adyntel),
  3. fallback-warm (owned scraper kept at low cadence as failover, parser
     kept alive against Meta UI drift),
  4. decommission decision (whether to fully retire the scraper, deferred
     until Adyntel proves stable at scale).
  Each phase is its own PR; the dual-write phase must ship a real integration
  test against the Adyntel API (50 free credits cover the POC).
- **If Option A:** a pipeline-hardening epic with SLAs — residential proxy
  rotation, CAPTCHA-solver integration, parser-resilience canary, and a
  documented uptime target. The "no fallback by design" gap is filed as its
  own issue either way.

## Verification (issue #1560 accept criteria)

```
# ADR exists
ls docs/adr/*adyntel* 2>/dev/null | grep -q . || exit 1
# ADR contains required sections
grep -q "Option A\|Option B\|Cost projection\|SLA\|ToS risk\|Moat preservation\|Fallback" docs/adr/*adyntel* || exit 1
# Decision recorded
grep -q "Decision:\|Chosen:" docs/adr/*adyntel* || exit 1
```

All three pass against this file:
- `ls docs/adr/2026-09-05-adyntel-meta-data-strategy.md` → exists.
- The file contains "Option A", "Option B", "Cost projection", "SLA",
  "ToS risk", "Moat preservation", and "Fallback" as section headings.
- The file contains a `Decision:` line (this section).

## Rollback

ADR is documentation only; no code or schema change. Revert the file addition
in a single PR. No D1, no Durable Object, no KV, no R2, no Worker config
changes.
