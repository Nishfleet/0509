# EPIC decomposition: auto competitor watch — discover competitors without the customer adding them

Epic: Nishfleet/0509#1366
Product direction (Nish, 2026-08-28, verbatim): "auto competitor watch without
adding competitors (new ones / existing ones / or just too many for customers to
add)".
North-star fit: this is watch-the-world capability the customer's own edge AI
cannot replicate (standing north star).
Process used: scout-and-plan → evals before specs → spec-gate → scoped queue
items. No implementation until specs exist. This document is the scout + eval
design; the scoped items are filed as issues referencing #1366 (listed in
§6).

## 1. Scout — what exists today (reuse, never reimplement)

The repo already ships the building blocks. Auto-discovery is a new *composition*
over existing primitives, not new machinery.

| Capability | File | Reuse role in auto-discovery |
|---|---|---|
| Domain + broader-scope Meta Ad Library search | `app/lib/search-v2.server.ts` | The search core. Auto-discovery runs many of these in one pass. |
| Commercial discovery resolver (browser scrape primary, Meta API fallback, honest demo mode) | `app/lib/ad-source.server.ts` | The actual ad fetch. Auto-discovery calls through this so caching, provider failover, and honesty carry over for free. |
| D1 discovery cache with TTL + staleness semantics | `app/lib/discovery-cache.server.ts` | Auto-discovery is search-heavy; every expanded-keyword probe must hit this cache or it burns Browser Rendering quota. |
| 12-brand eval panel + vertical probes + coverage reporter | `app/lib/discovery-panel.server.ts`, `scripts/discovery-panel-coverage.mjs` | **The eval methodology already exists.** Auto-discovery evals extend this panel (§3). |
| Website identity / alias resolution | `app/lib/website-identity.server.ts` | Deduping candidates against the customer's own domain and existing watchlists. |
| Ad analysis (hook, offer, destination, language) | `app/lib/analysis.server.ts` | Extracting the keyword/offer/country seed from the customer's own ads. |
| Landing-page signal extraction (CTA, price, form) | `app/lib/landing-page-signals.server.ts` | Seeding discovery when the customer has no ads yet (Phase 5). |
| Bulk competitor import (≤250 rows, plan-cap aware) | `app/lib/competitor-import.ts` | The "too many to add by hand" accept path (Phase 4). |
| Watchlist create + plan-limit enforcement | `app/lib/data/watchlists-core.server.ts` (`createWatchlistWithinLimit`, `checkPlanLimit`) | Auto-discovered candidates become watchlists through this; caps enforced. |
| Scheduled monitoring fan-out | `app/lib/monitoring-fanout.server.ts`, `workers/schedule.ts` | Periodic re-sweep cadence for "newly appearing" competitors (Phase 3). |
| Competitor dossier (honesty: "never a fake insight") | `app/lib/competitor-dossier.server.ts` | The truthfulness wedge auto-discovery must inherit — candidates are never confirmed competitors. |
| Plan gating (free/starter/agency) | `app/lib/plan.server.ts` | Auto-discovery is a paid-tier capability (free = 1 watchlist, manual). |

**Meta Ad Library constraint (verified in code):** the API searches by
`search_terms` (keyword) — there is no category/vertical browse endpoint
(`app/lib/meta-api.server.ts` ~L148-154). So competitor discovery is
keyword-driven: from the customer's own ads (or landing page) we extract a
keyword/offer/country seed, run expanded keyword searches, and dedupe the
advertisers that come back. This is the ceiling on what auto-discovery can find —
it can only surface advertisers with active ads on the searched terms. That
ceiling is stated honestly in every candidate's provenance.

## 2. The three buckets Nish named, mapped to discovery signals

1. **Established competitors the customer forgot** — brands already advertising
   in the customer's keyword/country space that the customer did not add.
   Signal: self-domain ads → extract keywords → search those terms → advertisers
   not in the customer's watchlists.
2. **Newly appearing competitors** — brands that started advertising in the
   space recently. Signal: periodic re-sweep of the keyword space; diff against
   the customer's current watchlists + already-surfaced candidates; only net-new
   advertisers surface as "newly appeared".
3. **The long tail too large to add by hand** — verticals with many advertisers.
   Signal: the same keyword expansion, but the accept path is bulk
   (`competitor-import.ts`, ≤250 rows), plan-cap enforced, not one-by-one.

## 3. Evals before specs

The repo already has the eval harness (`discovery-panel-coverage.mjs`,
`DISCOVERY_EVAL_PANEL`, "covered = ≥1 ad"). Auto-discovery evals extend it.
**Evals are defined before the specs** (development-workflow §1); each scoped
issue's acceptance criteria reference these.

### 3.1 Recall eval (does it find the known competitors?)
Ground truth: for each of the 12 eval-panel brands, a hand-verified set of
real competitors in that vertical (e.g. Allbirds → Rothy's, Vivaia, etc.).
Metric: of the known competitors, what fraction does auto-discovery surface as
candidates? **Pass bar: ≥60% on the panel** (the Meta-keyword ceiling means 100%
is unreachable — some competitors don't run ads on the same terms; the bar is
set against the ceiling, not against perfection).

### 3.2 Precision eval (are the surfaced candidates real competitors?)
Metric: of the surfaced candidates, what fraction are true competitors vs noise
(brands that bid on the keyword but are not in the vertical)? Sample = 30
candidates per vertical, hand-labeled. **Pass bar: ≥70% precision.** Below this,
the candidate ranker needs a stronger overlap signal (country/offer/hook
similarity) before shipping.

### 3.3 Coverage eval (what fraction of the vertical's active advertisers?)
Metric: count of unique advertisers auto-discovery surfaces for a vertical,
divided by the count a fully-exhaustive keyword sweep surfaces. **Pass bar:
≥80%.** This catches a ranker that is precise but drops the long tail.

### 3.4 Honesty eval (no guess renders as confirmed)
Metric: every auto-discovered candidate that reaches a UI surface carries a
"suggested / unverified" marker and a provenance line (which keyword/country
probe surfaced it). **Pass bar: 100%.** A candidate that renders without the
marker is a hard failure. This inherits the dossier truthfulness wedge
(`competitor-dossier.server.ts`: "never a fake insight").

### 3.5 Cap-respect eval (plan limits hold)
Metric: bulk-accept of candidates never exceeds the customer's plan limit;
over-cap candidates are rejected with a named reason, never silently dropped or
silently admitted. **Pass bar: 100%.** Reuses `checkPlanLimit` semantics.

## 4. Phased scope (smallest durable first)

Each phase is one filed issue (§6). Phases are ordered so each is independently
shippable and the first delivers the core loop.

- **Phase 1 — Self-domain competitor seed (core loop).** Given the customer's
  own domain, extract their ads' keywords/offers/countries, run keyword-expanded
  searches through the existing discovery resolver + cache, dedupe against
  existing watchlists via website-identity, return ranked candidates with
  overlap scores. Pure library function + integration test. No UI yet.
- **Phase 2 — Candidate review surface + honesty labels.** A "Suggested
  competitors" surface on the watchlists route; candidates render with
  "suggested / unverified" markers and provenance; one-click add reuses the
  existing add path. Honesty eval gates it.
- **Phase 3 — Periodic re-sweep for newly appearing competitors.** Scheduled
  task via the existing fan-out; diffs against current watchlists + already
  surfaced candidates; only net-new advertisers surface as "newly appeared".
- **Phase 4 — Long-tail bulk accept.** Accept all/filtered candidates in one
  action via `competitor-import.ts`'s bulk path; plan-cap enforced
  (`checkPlanLimit`); over-cap rejected with a named reason.
- **Phase 5 — Landing-page-seeded discovery (no ads yet).** For customers with
  no own ads found, crawl their landing page (`landing-page-signals.server.ts`)
  → extract value-prop keywords → seed the keyword search. The no-ads path must
  not fabricate candidates.

## 5. Out of scope for this epic

- Full-site competitor tracking (any change anywhere on their website) — that is
  epic (b), tracked separately. `competitor-site-monitor.server.ts` is its
  machinery.
- Competitor + self mention tracking across the internet (Reddit, X, Pinterest,
  media, blogs) — that is epic (c), Nishfleet/0509#1368.
- New paid data sources. Zero-spend rule: free/API-light first (Meta Ad Library
  keyword search is the only discovery source for this epic). Adding a paid
  discovery source is a Nish decision (money).
- Auto-adding competitors to a watchlist without customer confirmation.
  Auto-discovery surfaces *candidates*; the customer accepts. Silent
  auto-creation would burn plan quota and watchlist slots without consent.

## 6. Filed scoped items (this epic's queue)

Filed as issues in Nishfleet/0509, each with a spec-gated body (termination
command, deterministic-required vs AI-advisory split, evidence link) and
referencing #1366. Filed cap-aware: the first two carry `agent-ready` (within
fleet pickup capacity); the remainder are filed without it and will be labeled
`agent-ready` as the queue drains, so the fleet is not over-saturated.

| Phase | Issue | Status |
|---|---|---|
| 1 | #1369 | agent-ready |
| 2 | #1370 | agent-ready |
| 3 | #1371 | queued (no agent-ready yet) |
| 4 | #1372 | queued (no agent-ready yet) |
| 5 | #1373 | queued (no agent-ready yet) |

The spec-gate (`fleet-spec-gate.sh`) runs at pickup time before any implementer
touches a packet; this epic's decomposition produces the spec-gated bodies, the
gate ratifies them.
