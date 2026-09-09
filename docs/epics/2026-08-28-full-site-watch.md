# EPIC decomposition: watch the competitor's ENTIRE website — every change, anywhere

Epic: Nishfleet/0509#1367
Production state verified against `origin/main` on 2026-09-09.
Product direction (Nish, 2026-08-28, verbatim): "watch competitors entire website
(any changes anywhere for eg. product pages, policy, etc. etc. everything on
their website tracked)". Beyond ads: product pages, pricing, policies,
changelogs, careers, legal — full-site change tracking with meaningful diffs.
Process used: scout-and-plan → evals before specs → spec-gate → scoped queue
items. No implementation until specs exist. This document is the scout + eval
design; the scoped items are filed as issues referencing #1367 (listed in §6).

Note on adjacent work: #1259 (per-change criticality score on watchlist alerts)
is the natural component for scoring website-page changes — link, don't
duplicate. It is tracked as Q6 below.

## 1. Scout — what exists today (reuse, never reimplement)

The full-site watch foundation is ~90% built and tested in the repo. This epic
is a new *composition* over existing primitives, not a fresh machinery stack.
Everything below was verified live in the checkout at `6d28cb8c`.

| Capability | File | Reuse role in full-site watch |
|---|---|---|
| Sitemap discovery + bounded same-host crawl (robots-honoring, SSRF-hardened) | `app/lib/competitor-site-monitor.server.ts` | The discovery + crawl surface. Sitemap priority robots → `/sitemap.xml` → nested (bounded `SITEMAP_DOCUMENT_LIMIT=8`, `SITEMAP_URL_LIMIT=2000`); crawl fallback bounded `CRAWL_MAX_DEPTH=3`, never leaves root origin, hardened every hop. |
| Page classification (`WebsitePageKind`) | `app/lib/competitor-site-monitor.server.ts` | pricing / home / changelog / landing / product / blog / docs / about / contact / other (`classifyWebsitePageKind`). Careers currently → about, all legal paths → other (gap §2). |
| Per-class cadence + rotating-batch selection | `app/lib/competitor-site-monitor.server.ts` | `PAGE_KIND_CADENCE` (pricing 3h, home/changelog/landing 6h, product/blog/docs daily, about/contact/other weekly) + `selectWebsitePagesForRun` keeps hot classes always in, rotates cool classes deterministically. |
| Lease-fenced D1 storage | `app/lib/data/watchlist-site-pages.server.ts`, `migrations/0077_competitor_site_monitoring.sql` | `website_site_scan` (run manifest with honest `inventory_complete` + failure codes), `website_site_scan_page` (full inventory), `website_page_observation` (content hash, excerpt, `signals_json`, normalizer version, fetch status). Writes fenced by run `processing_token`. |
| Deterministic, pure change-evaluation core | `app/lib/competitor-site-content.ts` | `normalizeCompetitorPageContent` (suppresses cosmetic churn before hashing) + `evaluateWebsitePageChanges` (prior vs current inventory → ordered `WebsitePageChange` facts: `page-added`, `page-removed` only when current inventory complete, `field-changed` per field — `title`/`meta` non-alertable, `visibleText`/`offerPrice`/`cta` alertable, `form` non-alertable). Materiality flag + `materialReason` + `dedupeKey`; completeness evidence. **Tested** in `tests/competitor-site-content.test.ts`. |
| Event vocabulary + display | `app/lib/types.ts`, `app/lib/watch-event-display.ts`, `app/lib/watch-event-evaluator.server.ts` | `website_page_added` / `website_page_removed` / `website_page_changed` are already `WatchEventType` members with display labels ("Page added" / "Page removed" / "Page changed") and default importance scores. |
| Change mark (the one green diff) | `app/lib/change-mark.ts` | `readChangeMark` renders a before/after token diff from event metadata `from`/`to` (≤48 chars). Already used for landing-page events; reusable for website-page events verbatim. |
| Scan wiring hook | `app/lib/monitoring.server.ts` | `runWebsiteSiteScanForWatchlist` runs the scan behind `isFullSiteWatchEnabled(env)` (`FULLSITE_WATCH_ENABLED` env flag). |

**Key gap confirmed in code:** the change-evaluation core has **zero callers in
`app/`** — `runWebsiteSiteScan` stores observations but never loads the prior
run's observations and never calls `evaluateWebsitePageChanges`, so no
run-to-run comparison happens and no `website_page_*` events are ever emitted.
That wiring is the heart of this epic (Q2).

## 2. The precise gaps Nish's intent names that are missing

1. **Change detection is not wired into the scan.** No run-to-run comparison;
   the pure diff core exists and is tested but has zero callers.
2. **No website_page_* events are emitted.** The event types, display labels,
   and scores exist, but nothing converts `WebsitePageChange` facts into
   `watch_event` rows with `from`/`to` metadata, so no change reaches a board,
   digest, or instant alert.
3. **Careers and legal/policy are not first-class.** The vocabulary maps
   `careers` → `about` and legal paths (`/privacy`, `/terms`, `/legal`, `/gdpr`,
   …) → `other`. Watched, but not as distinct surfaces with their own cadence
   and display (Q4).
4. **The flag is ON in production.** Detection is wired (#1383), UI/digest
   surfacing is merged (#1384/#2096), and production enablement is merged
   (#1386/#2033). The canary list is still `nike.com www.nike.com` pending
   packet 8 (Q5).
5. **No evals before specs.** Nish's process requires evals that measure
   meaningful-diff quality before the spec is locked. No such eval harness
   exists yet (Q1).
6. **Per-change criticality is a separate item (#1259).** Link, don't
   duplicate: when #1259 ships `app/lib/change-criticality.server.ts`,
   website-page events feed into it (Q6).

## 3. Evals before specs (the gate before implementation)

Evals are defined before specs (development-workflow §1); each scoped issue's
acceptance criteria reference these. They measure the deterministic core
(`evaluateWebsitePageChanges` + `normalizeCompetitorPageContent`) against real
captured competitor pages, not synthetic fixtures alone.

### 3.1 EVAL-1 — cosmetic-suppression precision
Feed pairs of captures differing only by cosmetic churn (whitespace, attribute
reordering, analytics snippet injection, nav link reorder). **Pass bar: zero
`field-changed` facts on ≥95% of cosmetic-only pairs.**

### 3.2 EVAL-2 — materiality precision
Feed pairs with a genuine material change (price token change, CTA string
change, new product page, removed policy page). **Pass bar: ≥90% of material
changes produce an alertable fact with the correct field; ≤5% false-positive
alertable facts.**

### 3.3 EVAL-3 — removal honesty
Feed an incomplete current inventory (sitemap unreachable). **Pass bar: zero
`page-removed` facts emitted** (the core already enforces this; the eval pins it
against the wired path).

### 3.4 EVAL-4 — before/after readability
**Pass bar: every alertable fact's `before`/`after` is ≤500 chars and
human-readable (no raw HTML, no base64); the `ChangeMark` 48-char token
rendering succeeds on ≥80% of alertable facts.**

These evals are themselves a queue item (Q1) and are the spec-gate: the
change-detection spec (Q2) is not locked until EVAL-1..4 pass the bar.

## 4. Phased scope (smallest durable first)

Each phase is one filed issue (§6). Phases are ordered by dependency, each
independently shippable and the first delivers the spec-gate for the core loop.

- **Q1 — Full-site watch eval harness (evals before specs).** Build the
  EVAL-1..4 harness over captured competitor-page pairs. The spec-gate for Q2;
  it must land and pass before Q2's spec is locked. No new diff logic — the
  eval measures the existing core.
- **Q2 — Wire change detection + website_page_* event emission.** Inside
  `runWebsiteSiteScan` (or its caller), load the prior run's observations, call
  `evaluateWebsitePageChanges`, convert each `WebsitePageChange` fact into a
  `watch_event` row (`website_page_added`/`removed`/`changed`) with `from`/`to`
  metadata. Reuses the existing pure core — no new diff logic.
- **Q3 — Surface website_page events in UI, digests, instant alerts.**
  Watchlist detail tabs ("What changed"), digest items, instant-alert delivery.
  Reuses `change-mark.ts` as-is; honest coverage label
  (`buildWebsiteCoverageLabel`) — never a false "whole site" claim.
- **Q4 — First-class careers + legal/policy page categories.** Extend
  `WebsitePageKind` and classification so careers and legal/policy are distinct
  surfaces with their own cadence and display labels. *(Filed as #1385;
  closed — no longer part of the active queue. See §6.)*
- **Q5 — Production enablement + plan-tier page budgets + coverage label.**
  Set `FULLSITE_WATCH_ENABLED` in `wrangler.jsonc`, add per-tier site-page
  budgets to `app/lib/plan-entitlements.ts` (the deferred "packet 5"), surface
  the honest coverage label in the UI, and run a prod canary.
- **Q6 — Link per-change criticality (#1259).** When #1259 ships
  `change-criticality.server.ts`, wire website-page events into it. Tracked
  here so the dependency is explicit; blocked on #1259 becoming agent-ready.

## 5. Out of scope for this epic

- Self + competitor mentions across the internet (Reddit, X, Pinterest, media,
  blogs) — separate epic Nishfleet/0509#1368.
- Auto-discovery of competitors without the customer adding them — separate
  epic Nishfleet/0509#1366.
- Rebuilding any layer that already exists (discovery, classification,
  observation storage, change-eval core, event vocabulary, change mark).
- Per-change criticality scoring logic — that is #1259; this epic links to it,
  never rebuilds it.
- Paid data sources / paid crawlers. Zero-spend rule:
  free/API-light/site-owned-surface first (full-site watch reads the
  competitor's own published pages). Adding a paid source is a Nish decision
  (money).

## 6. Filed scoped items (this epic's queue)

Five items are active. Each carries a spec-gated body (termination command,
deterministic-required vs AI-advisory split, exact files, must-not-touch,
acceptance, metric, evidence link) and references #1367. Dependency ordering is
expressed via a machine-checkable `blocked-on:` body line, which the intake
tick's blocker filter honors (an `agent-ready` item whose `blocked-on:` target
is open stays held, not spawned), so the fleet is not over-saturated while the
chain drains.

| Phase | Issue | Label / status |
|---|---|---|
| Q1 | #1382 | `agent-ready` |
| Q2 | #1383 | `agent-ready` |
| Q3 | #1384 | `agent-ready`, `blocked-on: Nishfleet/0509#1383` |
| Q5 | #1386 | `agent-ready`, `blocked-on: Nishfleet/0509#1384` |
| Q6 | #1387 | `agent-ready`, `blocked-on: Nishfleet/0509#1383` |

(Q4, filed as #1385, was closed 2026-09 and is not part of the active queue; it
is documented in §4 for completeness.)

The spec-gate (`lib/agent-ready-spec-gate.py check-body`) runs against each
body before `agent-ready` applies; this epic's decomposition produces the
spec-gated bodies and the gate ratifies them.
