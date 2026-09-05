# Full-Site Watch EPIC — Scout-and-Plan

Epic: #1367 — "watch the competitor's ENTIRE website — every change, anywhere"
Nish intent (verbatim): "watch competitors entire website (any changes anywhere for eg. product pages, policy, etc etc. everything on their website tracked)"
Process (Nish): scout-and-plan → evals before specs → spec-gate → scoped queue items referencing this epic.
Date: 2026-08-28.

This document is the **scout-and-plan** deliverable for the epic. It inventories
what already exists, names the precise gaps against Nish's intent, defines the
evals that must precede specs, and scopes the work into concrete queue items
(filed as issues referencing #1367). Implementation lands in those items, not
here. Per Nish's stated process, evals come before specs and specs before
implementation — so this PR ships the plan and the queue items, not code.

## What already exists (do not rebuild)

The full-site watch foundation is ~90% built and tested. Every item below was
verified live in the checkout at `6d28cb8c`.

**Discovery + crawl** — `app/lib/competitor-site-monitor.server.ts`
- Sitemap discovery in priority order: robots-declared → `/sitemap.xml` → nested
  sitemaps (bounded `SITEMAP_DOCUMENT_LIMIT=8`, `SITEMAP_URL_LIMIT=2000`).
- Bounded same-host crawl fallback (`CRAWL_MAX_DEPTH=3`) honoring robots
  `Disallow`, never leaving the root origin, SSRF-hardened on every hop
  (`safeFetchDocument` + `app/lib/public-url.server.ts`).
- Page classification into `WebsitePageKind`: `pricing`, `home`, `changelog`,
  `landing`, `product`, `blog`, `docs`, `about`, `contact`, `other`
  (`classifyWebsitePageKind`).

**Cadence + batch selection** — same file
- Per-class cadence policy (`PAGE_KIND_CADENCE`): pricing every 3h, home/
  changelog/landing every 6h, product/blog/docs daily, about/contact/other
  weekly. Rotating-batch selection (`selectWebsitePagesForRun`) keeps hot
  classes always in and rotates cool classes deterministically.

**Storage (lease-fenced, D1)** — `app/lib/data/watchlist-site-pages.server.ts`
+ `migrations/0077_competitor_site_monitoring.sql`
- `website_site_scan` (run manifest, one row per watchlist_run, honest
  `inventory_complete` flag + failure codes).
- `website_site_scan_page` (full page inventory per scan).
- `website_page_observation` (one row per fetched canonical URL: content hash,
  excerpt, structured `signals_json`, normalizer version, fetch status).
- All writes fenced by the run's `processing_token`; retries converge.

**Change-evaluation core (deterministic, pure)** —
`app/lib/competitor-site-content.ts`
- `normalizeCompetitorPageContent` — HTML normalization that suppresses
  cosmetic churn before hashing.
- `evaluateWebsitePageChanges` — compares a prior inventory to a current
  inventory and produces ordered `WebsitePageChange` facts:
  `page-added`, `page-removed` (only when current inventory complete),
  `field-changed` per field (`title`, `meta` non-alertable; `visibleText`,
  `offerPrice`, `cta` alertable; `form` non-alertable). Before/after values
  bounded to `COMPETITOR_PAGE_FACT_BEFORE_AFTER_LIMIT=500`. Materiality flag +
  `materialReason` + `dedupeKey` on every fact. Completeness evidence carried.
- **Tested** in `tests/competitor-site-content.test.ts`.

**Event vocabulary + display** — `app/lib/types.ts`,
`app/lib/watch-event-display.ts`, `app/lib/watch-event-evaluator.server.ts`
- `website_page_added`, `website_page_removed`, `website_page_changed` are
  members of `WatchEventType`.
- Display labels exist ("Page added" / "Page removed" / "Page changed").
- Default importance scores exist (0).

**Change mark (the one green diff)** — `app/lib/change-mark.ts`
- `readChangeMark` renders a before/after token diff from event metadata
  `from`/`to` (≤48 chars). Already used for landing-page events; reusable for
  website-page events verbatim.

**Wiring hook** — `app/lib/monitoring.server.ts:2189`
- `runWebsiteSiteScanForWatchlist` runs the scan behind
  `isFullSiteWatchEnabled(env)` (`FULLSITE_WATCH_ENABLED` env flag).

## The precise gaps (what Nish's intent needs that is missing)

1. **Change detection is not wired into the scan.** `runWebsiteSiteScan`
   stores observations but never loads the prior run's observations and never
   calls `evaluateWebsitePageChanges`. The pure diff core exists and is tested
   but has zero callers in `app/`. No run-to-run comparison happens.

2. **No website_page_* events are emitted.** The event types, display labels,
   and default scores exist, but nothing creates `website_page_added` /
   `website_page_removed` / `website_page_changed` watch events. The
   `WebsitePageChange` facts the core produces are never converted into
   `watch_event` rows with `from`/`to` metadata. So no change ever reaches a
   watchlist board, digest, or instant alert.

3. **Careers and legal/policy are not first-class.** Nish named "product pages,
   pricing, policies, changelogs, careers, legal". The current vocabulary maps
   `careers` → `about` and all legal paths (`/privacy`, `/terms`, `/legal`,
   `/gdpr`, …) → `other`. They are watched, but not as distinct surfaces with
   their own cadence and display — so a careers page change is labeled "about"
   and a policy change is labeled "other", which undersells both.

4. **The flag is OFF in production.** `FULLSITE_WATCH_ENABLED` is not set in
   `wrangler.jsonc`. The entire system never runs in prod. No canary, no
   coverage label in the UI, no plan-tier page budgets
   (`app/lib/plan-entitlements.ts` has no site-page budget field — "packet 5
   plan metering" is explicitly deferred in the code comments).

5. **No evals before specs.** Nish's process requires evals that measure
   meaningful-diff quality (cosmetic-suppression precision, materiality
   precision, false-positive rate on real competitor sites) *before* the spec
   is locked. No such eval harness exists yet.

6. **Per-change criticality is a separate item (#1259).** #1259
   (`research-delta: Per-change criticality score on watchlist alerts`) is the
   natural component for scoring website-page changes. It is currently a
   `scout-candidate`, not yet agent-ready. Link, don't duplicate: when #1259
   ships `app/lib/change-criticality.server.ts`, website-page events feed into
   it; this epic must not rebuild criticality.

## Evals before specs (the gate before implementation)

Before any spec is locked for the change-detection wiring (gap 1+2), the
following evals must exist and pass a stated bar. They measure the
deterministic core (`evaluateWebsitePageChanges` + `normalizeCompetitorPageContent`)
against real captured competitor pages, not synthetic fixtures alone.

- **EVAL-1 cosmetic-suppression precision.** Feed pairs of captures that differ
  only by cosmetic churn (whitespace, attribute reordering, analytics snippet
  injection, nav link reorder). Bar: zero `field-changed` facts on ≥95% of
  cosmetic-only pairs.
- **EVAL-2 materiality precision.** Feed pairs with a genuine material change
  (price token change, CTA string change, new product page, removed policy
  page). Bar: ≥90% of material changes produce an alertable fact with the
  correct field; ≤5% false-positive alertable facts.
- **EVAL-3 removal honesty.** Feed an incomplete current inventory (sitemap
  unreachable). Bar: zero `page-removed` facts emitted (the core already
  enforces this; the eval pins it against the wired path).
- **EVAL-4 before/after readability.** Bar: every alertable fact's
  `before`/`after` is ≤500 chars and human-readable (no raw HTML, no base64).
  The `ChangeMark` 48-char token rendering must succeed on ≥80% of alertable
  facts.

These evals are themselves a queue item (see Q1) and are the spec-gate: the
change-detection spec (Q2) is not locked until EVAL-1..4 pass the bar.

## Scoped queue items (filed as issues referencing #1367)

Each item is a separate issue, scoped to land as its own PR. They are ordered
by dependency. Filing them is the deliverable of this epic's planning phase.

- **Q1 — Full-site watch eval harness (evals before specs).** Build the
  EVAL-1..4 harness over captured competitor-page pairs. This is the spec-gate
  for Q2; it must land and pass before Q2's spec is locked.
- **Q2 — Wire change detection + website_page_* event emission into the site
  scan.** Inside `runWebsiteSiteScan` (or its caller), load the prior run's
  observations, call `evaluateWebsitePageChanges`, convert each
  `WebsitePageChange` fact into a `watch_event` row
  (`website_page_added`/`removed`/`changed`) with `from`/`to` metadata. Spec
  locked only after Q1 passes. Reuses the existing pure core — no new diff
  logic.
- **Q3 — Surface website_page events in UI, digests, and instant alerts.**
  Watchlist detail tabs, digest items, instant-alert delivery. Reuses
  `change-mark.ts` for the diff token.
- **Q4 — First-class careers + legal/policy page categories.** Extend
  `WebsitePageKind` and classification so careers and legal/policy are
  distinct surfaces with their own cadence and display labels.
- **Q5 — Production enablement + plan-tier page budgets + coverage label.**
  Set `FULLSITE_WATCH_ENABLED` in `wrangler.jsonc`, add per-tier site-page
  budgets to `app/lib/plan-entitlements.ts` (the deferred "packet 5"), surface
  the honest coverage label (`buildWebsiteCoverageLabel`) in the UI, and run a
  prod canary.
- **Q6 — Link per-change criticality (#1259).** When #1259 ships
  `change-criticality.server.ts`, wire website-page events into it. Tracked
  here so the dependency is explicit; blocked on #1259 becoming agent-ready.

## Out of scope for this epic

- Self-mentions across the internet (separate epic #1368).
- Auto-discovery of competitors (separate epic #1366).
- Rebuilding any layer that already exists (discovery, classification,
  observation storage, change-eval core, event vocabulary, change mark).

## Verification (this PR)

This PR ships a planning document only — no code paths change. Verification is:
- `npm run typecheck` clean (no types touched).
- `npm test` clean (no behavior touched; the plan doc is not imported).
- The six queue items (Q1–Q6) are filed as issues referencing #1367, linked
  below in the PR body.
