# Five to Nine — Product Readiness Spec

**Date:** 2026-07-18 · **Author:** Full-product audit (code + live-site) · **Consumer:** an implementation agent (Cursor Composer / Grok / similar)

This spec is the output of a six-dimension audit (marketing funnel, onboarding, core search loop, retention/emails, billing/margins, UI polish) plus a live walkthrough of https://0509.io. It lists every gap that stands between the current product and one that converts and retains paying customers, ordered by leverage.

---

## 0. HOW TO USE THIS SPEC (read first, every session)

You are implementing work packages (WP-xx) in a production SaaS. Follow these rules without exception:

1. **Line numbers are indicative, not authoritative.** The codebase moves daily. Locate code by the quoted anchor strings and function names, never by line number alone. If an anchor string is missing, the code may have already been fixed — verify behavior before changing anything, and skip the package if it's already done.
2. **One work package per branch/PR.** Never bundle packages. Name branches `spec/wp-XX-short-name`.
3. **Verification loop for every package:** `npm test` and `npm run build` must pass before you consider a package done. Add the tests listed in each package's Acceptance section. Never weaken or delete an existing test to make your change pass.
4. **Never run `npm run deploy`.** Deploys happen automatically via CI on merge to `main`. Never push directly to `main`.
5. **Schema changes** go only through a new sequentially-numbered file in `migrations/` (current head: check `ls migrations/ | sort | tail -1`). Never run DDL any other way. Never edit an existing migration.
6. **D1 queries:** always parameterized `.bind()`. Never string interpolation into SQL.
7. **Immutability:** create new objects, never mutate existing ones.
8. **Honesty convention:** never make the product claim something it didn't verify. Demo data must be labeled. If live discovery fails, fail honestly — never silently fall back to demo (`allowDemoFallback` stays `false` by default).
9. **Global-first convention:** no India/IST defaults anywhere. Timestamps render in viewer timezone (`app/components/local-time.tsx`), country defaults come from `cf-ipcountry`, currency handling covers all major currencies.
10. **CSS is pure CSS in `app/app.css`** — no Tailwind, no CSS-in-JS, no new styling libraries. Design yardstick is `DESIGN.md` (Vercel aesthetic).
11. **Email** always goes through the `EMAIL` binding via `delivery.server.ts` with an idempotency key, a `delivery_attempt` record, and `List-Unsubscribe` headers. Never add ad-hoc sends.
12. **No new npm dependencies** unless the package explicitly says so.
13. **Do not touch:** `legacy/`, `docs/customer-claim-surface-registry.json`, `e2e/helpers/release-*`, `scripts/run-local-release-proof.mjs`, `playwright.config.ts` — these are owned by a separate release-verification workstream (Codex).

### Conflict policy with in-flight Codex work

As of 2026-07-18, a Codex agent has an unmerged branch (`codex/customer-readiness-inventory-closeout`) with pending edits to: `app/routes/marketing.tsx`, `app/lib/pricing.ts`, `app/routes/app.watchlists.tsx`, `app/lib/monitoring.server.ts`, `app/routes/compare.magicbrief.tsx`, plus release-proof tooling.

- **This spec assumes you start AFTER that branch has merged.** Before your first package: `git fetch && git log --oneline -5 origin/main` and confirm a commit mentioning "inventory closeout" or "customer-readiness" exists, OR ask the operator. Always branch from latest `origin/main`.
- Packages tagged **[CODEX-OVERLAP]** touch those files. For those: re-read the current file content first; the exact copy strings quoted here may have shifted. Apply the *intent* of the package to the current code.
- Marketing copy changes will invalidate entries in Codex's claim-surface registry. That is expected and acceptable — the registry re-proof is Codex's job, not yours. Just never edit the registry file yourself.
- All other packages (search/scraper, CSS, emails, billing internals, onboarding routes) have no overlap and can start any time.

### Priority legend

- **P0** — broken, dishonest, or directly costing conversions today.
- **P1** — significant conversion/retention/margin improvement.
- **P2** — polish; do after P0/P1 in the same phase.

### Recommended execution order

Phase A (money moment) → Phase B (CSS foundation) → Phase C (retention emails) → Phase D (funnel copy) → Phase E (billing/margins) → Phase F (onboarding) → Phase G (polish). Within a phase, run packages in listed order. A and B are independent and can run in parallel if two agents are available.

---

## LIVE-SITE EVIDENCE (why Phase A is first)

Verified by hand on 2026-07-18 against production:

- Searching **glossier.com** (US) — a major Meta advertiser — returned **"0 ads found"**, labeled "Search complete." The broader keyword search also returned 0. A marketer testing with their own competitor sees an empty product and leaves.
- Searching **nike.com** (US) returned **7 ads** (Nike runs hundreds): mostly **Spanish-language** ads for a US-country search, the auto-selected "Selected proof" was an **inactive** ad, and one Spanish ad was labeled **"Vietnamese"**.
- The landing page's own hero demo (Nykaa) shows a **stale cached ad** ("Sale is now on till 20th May!" displayed in July), **no creative image** (gray "Image" chip), and analysis fields where HOOK and OFFER are both the full ad text repeated, with "Not detected" for creative text, landing headline, CTA, price, and form.
- The UI shows internal jargon to anonymous visitors: "Legacy source results; website connection is not yet verified", "1 ads found" (grammar).

The landing page itself is distinctive and good. The product behind the "try it" click is what loses the customer. **Nothing else in this spec matters if the first search result looks dead.**

---

## PHASE A — THE MONEY MOMENT (core search & analysis)

### WP-01 [P0] Capture creative thumbnails in the browser scraper

**Files:** `app/lib/meta-library-browser.server.ts`, `app/lib/meta-library-rendered-card-parser.server.ts`, `app/lib/types.ts`, `app/routes/search.tsx`

Currently the browser-scrape extraction scripts (three paths: session extraction, Quick Actions, Browserless — look for the DOM-walking script blocks around the card parsing) collect **no** `<img>`/`<video>` sources. `creativeImageUrl` only gets populated later, from the snapshot page's og:image, when a *signed-in* user selects an ad (`app/lib/search-selection.server.ts`, anchor: `creativeImageUrl`). Anonymous visitors — the conversion audience — see gray placeholders on every card.

**Change:**
1. In each of the three extraction scripts, for every ad card collect the first `img[src]` whose URL host contains `fbcdn` or `scontent` (skip profile pictures: skip images with square dimensions ≤ 64px if measurable, else take the largest image in the card). Also collect `video[poster]` if present, and set a boolean `hasVideo`.
2. Thread the new fields through `ExtractedAdCard` → `normalizeExtractedCard` → `AdRecord.creativeImageUrl` (field already exists on the type) and a new optional `AdRecord.creativeFormatHint: "image" | "video" | undefined`.
3. In `app/routes/search.tsx` result cards, render the thumbnail via the existing `AdThumb` component (`app/components/ad-thumb.tsx`) for all users including anonymous.

**Acceptance:**
- A live search for a large advertiser renders real thumbnails on >70% of cards while signed out.
- Unit test: `normalizeExtractedCard` maps an extracted card with `imageUrl` to `AdRecord.creativeImageUrl`.
- No fabrication: when no image is found, the labeled `AdThumb` fallback renders (never a broken img).

### WP-02 [P0] Depth: scroll-and-collect pagination in the browser scraper

**Files:** `app/lib/meta-library-browser.server.ts`, `app/lib/ad-source.server.ts`, `app/routes/search.tsx`

All browser discovery paths return `nextCursor: null` (anchors: three occurrences of `nextCursor: null`), so results cap at one unscrolled viewport (~5–15 cards). Nike US returned 7 ads. Competitors with 200 live ads show a dozen at best. This is the #1 perceived-value gap.

**Change:**
1. In the session-based extraction path, after page-ready, perform up to 3 scroll passes (`window.scrollTo(0, document.body.scrollHeight)` + ~2s wait each), re-run card extraction after each pass, and dedupe by `libraryId`. Bound total added time to ≤10s. Respect the existing navigation/wait timeout constants (anchors: `NAVIGATION_TIMEOUT`, `PAGE_READY`); do not raise them.
2. Target 30–50 ads per search when the advertiser has them.
3. If the Meta API fallback path is active, honor its real `forward_cursor` pagination instead (anchor: `forward_cursor` in `app/lib/meta-api.server.ts`) for up to 2 extra pages.
4. Surface a "Load more" control in `search.tsx` only when a cursor/next-page actually exists — never a dead button.

**Acceptance:**
- Live search for nike.com (US) returns ≥25 ads.
- Dedupe test: repeated card IDs across scroll passes appear once.
- Scan-cost guard: scheduled watchlist scans (`monitoring.server.ts`) keep their existing page budget (anchor: `DEFAULT_PAGE_BUDGET`) — deep scrolling is for interactive search only. Add a parameter so the scraper knows which mode it's in; default to shallow.

### WP-03 [P0] Real analysis derivation (kill the copy-paste Hook/Offer)

**Files:** `app/lib/analysis.server.ts`, `app/lib/meta-library-browser.server.ts`, `app/routes/search.tsx`

For browser-scraped ads: `hook = previewHeadline` and `offer = entire body` (anchor in `meta-library-browser.server.ts`: the normalization block assigning `hook:` and `offer:`), `format` is hardcoded `"image"`, every ad shows the same boilerplate "Why this may matter" sentence, and confidences 0.86/0.84 are hardcoded (anchor in `analysis.server.ts`). The result: the detail panel repeats the ad text under three different labels — visibly fake analysis.

**Change:**
1. `deriveHook`: first sentence OR first line of the body, capped at 120 chars, stripped of emoji runs >2.
2. `deriveOffer`: extract the discount/price/promo phrase. Extend the regex beyond INR: `%\s?off`, `free shipping|delivery`, `buy \d+ get \d+|bogo`, currency amounts for `₹ $ € £ ¥ R$ ₺ zł` plus `from|starting at` variants, `sale|deal ends?`. If nothing matches, return `null` — and the UI must then show "No explicit offer detected" instead of repeating the body.
3. Never set `hook` and `offer` to identical strings. If they collide, null the offer.
4. Delete the hardcoded confidence numbers from display (keep internal fields if tests rely on them, but the UI must not print fabricated confidence).
5. Replace the constant `researchSummary` with a composed line from real signals, e.g. `"Running 62 days · 3 variants · discount offer · links to nykaa.com"` — use only fields actually present; omit missing ones.

**Acceptance:**
- Unit tests: USD/EUR/GBP offer strings extract; hook ≠ offer for any input; empty-offer input renders the honest fallback.
- On a live multi-ad search, every "Why this may matter" summary is derived from that ad's verified signals and the old constant fallback is absent. Equal summaries are allowed when the verified input signals are equal.

### WP-04 [P0] Stop the creative-type filter from silently zeroing results

**Files:** `app/routes/search.tsx`, `app/lib/meta-library-browser.server.ts`

Every browser-scraped ad has `format: "image"`, so filtering by Video/Carousel always yields an honest-looking "No ads found". Also `buildSearchUrl` hardcodes `active_status=all` and `media_type=all` (anchor: `buildSearchUrl`), discarding the user's Status/Creative filters upstream, then post-filtering the single scraped page — wasting scarce results.

**Change:**
1. Map `filters.creativeType` → the Ad Library URL's `media_type` param and `filters.status` → `active_status` in `buildSearchUrl`. Keep client-side post-filtering as a safety net.
2. Until real format detection ships (WP-01's `creativeFormatHint` gives partial coverage: `hasVideo` → `"video"`), when provider is the browser scraper and the user selects Video/Carousel, show an honest notice: "Format filters are approximate for this source" rather than a silent empty state.

**Acceptance:** searching with `creativeType=video` for a video-heavy advertiser returns results (or the labeled notice), never a bare "0 ads found" caused by the format hardcode. URL-construction unit test asserts the params.

### WP-05 [P1] Auto-retry while discovery is warming

**Files:** `app/routes/search.tsx`

Cold-path searches show "Commercial discovery is already warming… Retry shortly" with a **manual** retry link (anchor: `warming`). First-time visitors interpret this as broken and leave.

**Change:** when the loader returns `discoveryProgress: "warming"`, auto-revalidate client-side every 5s for up to 60s (pattern already exists in `CheckoutReturnBanner` in `app.dashboard.tsx` — copy the poll-with-cap approach). Show a live "Checking the Ad Library now — usually under a minute" state with the existing skeleton shimmer, then results or an honest failure.

**Acceptance:** with a cold cache, the page resolves to results without any user click. Poll stops at cap. Test the revalidation hook logic.

### WP-06 [P1] Country relevance: pass the country filter honestly and rank active ads first

**Files:** `app/lib/meta-library-browser.server.ts`, `app/routes/search.tsx`

Live evidence: US search for Nike returned mostly Spanish ads and auto-selected an inactive ad as "Selected proof". The scraped card's `countries` are back-filled from the search filter (not read from the card), and result order is raw DOM order.

**Change:**
1. Verify `buildSearchUrl` passes the user's country into the Ad Library `country=` param (it should; fix if not).
2. Default sort for display: active ads before inactive; then longest-running first (using `firstSeenAt`). Never auto-select an inactive ad as the featured "Selected proof" when any active ad exists.
3. Add a client-side sort select: "Longest running / Newest / Active first" (fields already exist).

**Acceptance:** unit test for the sort comparator (active-first, then longevity); featured-proof selection test skips inactive when active exists.

### WP-07 [P1] Fix the language-classifier miss on Spanish

**Files:** `app/lib/language-classifier.ts`, `tests/` (existing classifier tests)

Live evidence: "Entra a Nike.com y encuentra actualizaciones semanales de producto con envío gratis." was labeled **Vietnamese**. Spanish and Vietnamese are both Latin-script cue-word profiles; the cue lists misfire on this sentence.

**Change:** reproduce with that exact string in a test. Strengthen the Spanish profile (cue words like `y encuentra entra con de producto gratis semanales envío`) and require a minimum cue-hit margin between the top two Latin-script candidates; below the margin, fall back to English/ambiguous (the existing Workers-AI detect fallback then corrects it at selection time).

**Acceptance:** the Nike sentence classifies as Spanish; existing 34-language tests still pass; add 3 more real-world Spanish/Portuguese/Italian ad sentences as regression cases.

### WP-08 [P1] Keep the "N ads use this creative" variant signal

**Files:** `app/lib/meta-library-rendered-card-parser.server.ts`, `app/lib/types.ts`, `app/routes/search.tsx`

The parser matches `"N ads use this creative and text"` and **discards** it as UI noise (anchor: `isTextCardUiLine`). This is a free spend/A-B-testing proxy — exactly what marketers pay ad-spy tools for.

**Change:** parse the count into `AdRecord.variantCount?: number`. Render a small pill "×N variants" next to the existing longevity pill (`AdLongevityPill`), and feed it into WP-03's `researchSummary` line.

**Acceptance:** parser unit test extracts the count; card renders the pill only when present.

### WP-09 [P1] Public-search UX copy: kill internal jargon

**Files:** `app/routes/search.tsx`

Anonymous visitors currently see: "Legacy source results; website connection is not yet verified", "1 ads found", "Create an account to confirm this website and queue its first evidence scan."

**Change:**
1. Replace the "Legacy source…" line with nothing (drop it) — the Source/freshness labels already communicate provenance.
2. Pluralize correctly: "1 ad found" / "N ads found" (make a tiny helper, use everywhere in the results header and answer panel).
3. Rewrite the two signup CTAs (anchors: `queue its first evidence scan`) to benefit language: `"Create a free account and we'll keep watching {domain} — first scan runs immediately, and you'll get an email when their ads, offer, or landing page changes."` (fallback "this competitor" when domain is null).

**Acceptance:** the quoted jargon strings no longer appear in the route; route tests updated; CTA renders the interpolated domain.

### WP-10 [P2] Persist saved-ad thumbnails to R2 so boards don't rot

**Files:** `app/lib/search-selection.server.ts`, `workers/app.ts` (serving route), `wrangler.jsonc` (R2 binding exists: `LANDING_PAGE_ARTIFACTS`)

`creativeImageUrl` is a hotlinked fbcdn URL with an expiring signature; saved board thumbnails go gray within weeks (the `AdThumb` fallback hides the rot).

**Change:** on ad save (collection add), fetch the creative image (respect existing SSRF guards — reuse the guarded fetch used by `creative-text.server.ts`), store bytes in R2 keyed `creatives/{metaAdId}.jpg` (skip if >2MB), and serve via a worker route `/artifacts/creatives/:id` with long cache headers. Fall back to the fbcdn URL when R2 is empty.

**Acceptance:** saving an ad persists the object; the board renders from the artifact route; a missing object falls back gracefully. Cost note: only on explicit save, never on search.

### WP-11 [P2] Selection latency: paint fast, enrich async

**Files:** `app/routes/search.tsx`, `app/lib/search-selection.server.ts`

Selecting an ad currently blocks on landing-page fetch (12s cap) + snapshot OCR (12s + image fetches) + serial translation before rendering.

**Change:** return the base ad detail immediately; run OCR/translation/landing-signals via `ctx.waitUntil` and let the client revalidate once after ~4s (single revalidation, not a poll). Show labeled "Analyzing creative…" placeholders in the enrichment slots.

**Acceptance:** selection paints in <3s on a warm search; enrichment fields fill on revalidation; no duplicate enrichment work (idempotency on the persisted enrichment).

---

## PHASE B — DESIGN-SYSTEM FOUNDATION (app.css)

Read `DESIGN.md` before this phase. The workspace CSS has five generations layered by override; these packages are mostly mechanical but must be done in order.

### WP-12 [P0] Fix the broken token scope (workspace has no working grays)

**Files:** `app/app.css`

`--f9-search-ink/muted/soft` are defined only on `.f9-search-page`, `.f9-auth-page`, `.f9-onboard-page`, `.f9-legal/error/share-page`; `--ld-*` only on `.f9-home` and the public-funnel scope. `.f9-dash-page` defines **neither**, yet ~85 declarations inside `/app` use these vars bare (e.g. `.f9-muted-copy { color: var(--f9-search-muted); }`). Undefined var → `color` inherits full-contrast body ink, so ALL secondary text in the workspace renders as dark ink. This flattens hierarchy on every app screen.

**Change:** define one canonical token block on `:root` (warm values consistent with the bone workspace):

```css
:root {
  --ink: #171611; --ink-soft: #55524a; --ink-faint: #6e6a5e;
  --line: #e0ddd4; --card: #fffdf8; --bone: #f4f1e8;
  --green: #16c47f; --green-ink: #064d31; --green-wash: #d9f6e8;
  --red: #b42318; --red-wash: #fff8f7; --amber-wash: #fffaf2;
}
```

Then alias the legacy names at `:root` (`--f9-search-ink: var(--ink);` etc.) so every bare reference resolves. Do NOT attempt a mass rename in the same package.

**Acceptance:** computed color of `.f9-muted-copy` inside `/app/watchlists` is the muted value, not `#061629`. Grep: no `var(--f9-search-` or `var(--ld-` reference can resolve undefined at any scope (every legacy token aliased at `:root`).

### WP-13 [P0] Define the missing classes and fix broken states

**Files:** `app/app.css`

Four confirmed holes:
1. `.f9-inline-actions` — used in 5 files (dashboard follow-ups, `ErrorState`, `PlanLimitState`, billing), zero CSS. Add: `.f9-inline-actions { display: flex; flex-wrap: wrap; gap: 10px; }`.
2. `.f9-status-strip.is-warning` — used on the dashboard's ad-source strip, no rule → degraded source looks healthy (an honesty bug). Add a visibly-warning treatment: `border-color: #e8c4c0; background: var(--red-wash);`.
3. `--f9-search-accent` is referenced by `accent-color` on auth checkboxes but never defined → default blue checkbox on the bone auth card. Define `--f9-search-accent: var(--green-ink);`.
4. `.f9-empty-row` variant class (used by `EmptyState`) has no rule — style it or remove the variant from `app/components/empty-state.tsx`.

**Acceptance:** error-state action buttons have visible spacing at 360px width; the warning strip is visually distinct from healthy; the signup checkbox is brand green.

### WP-14 [P1] Purge dead CSS strata

**Files:** `app/app.css`

Roughly 1,500+ lines verified unreferenced by any route/component. Delete the following blocks (verify each with a repo-wide grep for the class prefix before deleting; skip any that now has a reference): `.f9-market-desk*`, `.f9-revenue-brief-*`, `.f9-first-fifteen-*`, `.f9-setup-card/-list`, `.f9-value-loop-*`, `.f9-search-dashboard-*`, `.f9-search-hero-grid/-intake-card/-usage-card`, `.f9-watch-strip`, `.f9-inline-save`, `.f9-search-samples`, `.f9-search-activity-tabs`, the original dark search hero + gradients (neutralized by later overrides), the auth gradient (display:none'd), the old glassmorphism pricing block (unreachable outside `.f9-home`), and the three explicit `display:none` tombstones together with the rules they hide. Also remove all remaining purple/violet values (`#8b5cf6`, `#7047ff`, `#4b2aa1`, `rgba(139, 92, 246`) — restyle the one live usage (`.f9-proof-usage-alert`, used on the dashboard) with the amber/red state family instead.

**Acceptance:** every remaining class in app.css greps at least once in `app/routes` or `app/components`; `grep -ci "8b5cf6\|7047ff\|4b2aa1\|139, 92, 246" app/app.css` returns 0; `npm run build` passes; spot-check dashboard, search, watchlists, billing, landing render unchanged (screenshot compare).

### WP-15 [P1] Normalize font weights and load only real ones

**Files:** `app/app.css`, `app/root.tsx`

53 declarations use weights Inter doesn't load (950/850/760/750/740/650) — they snap to 800–900, making the workspace a wall of heavy text. DESIGN.md mandates 400/500/600 with 600–700 max for headings.

**Change:** mechanical replacement in app.css — 950/900/850/800 → 700 (page/panel headings) or 600 (labels/kickers/buttons); 760/750/740 → 600; 650 → 600. Body stays 400/500. Then trim the Google Fonts request in `root.tsx` to Inter 400;500;600;700.

**Acceptance:** `grep -c "font-weight: 9" app/app.css` = 0; no declared weight absent from the loaded set; visual check: headings still clearly heavier than body.

### WP-16 [P1] One button, one card, one focus ring for the workspace

**Files:** `app/app.css`

- Buttons: `.f9-primary-button` is a 999px pill, weight 900, heavy shadow — while its topbar override is already 8px/no-shadow, so the same button renders two shapes on one screen. Make the base: 8px radius, weight 600, no drop shadow (ring-border hover per DESIGN.md), and delete the pill/topbar override pair. Same for `.f9-danger-button`.
- Cards: standardize on the billing-card treatment (`.f9-app-plan-card` — 8px radius, subtle Vercel ring shadow). Change `.f9-app-panel` (28px radius, 70px-blur shadow) and `.f9-detail-cell` (22px) to match. Pills (999px) remain only on badges/status dots.
- Focus: one `:focus-visible` ring inside `/app` — 2px, green-family (`var(--green-ink)` on bone), replacing the global blue `#2563eb` there. Keep the landing's existing ring.

**Acceptance:** border-radius of `.f9-app-panel`/`.f9-detail-cell` is 8px; no box-shadow blur >8px inside `/app`; tab through `/app/watchlists` — every focusable element shows the green ring; `npm run build` passes.

### WP-17 [P2] Workspace brand voice: display face + mono kickers + icons

**Files:** `app/app.css`, `app/components/dashboard-shell.tsx`, new `app/components/icons.tsx`

The landing uses Bricolage Grotesque (loaded already) and IBM Plex Mono kickers; the paid workspace is Inter-everywhere — the "generic AI look" inside the product customers pay for. Also zero icons anywhere (13 text-only nav links).

**Change:** (1) page `h1` + panel `h2` in `/app` → `font-family` of the display face at 600–700; `.f9-app-kicker` → the mono kicker treatment already used on `/search`. (2) Add a single inline-SVG icon component file (~14 16px stroke icons, `currentColor`, hand-written or from Lucide's SVG paths — no npm dependency) and use them in the rail nav + status pills + empty states, keeping text labels.

**Acceptance:** dashboard h1 renders the display face; rail items have leading icons; no new npm package.

### WP-18 [P2] Consolidation sweep

**Files:** `app/app.css`, `app/root.tsx`

- Collapse 128 hex colors to the WP-12 token sheet (<30 distinct values remaining).
- One ink: replace navy `#061629` body ink inside `/app` with `var(--ink)`.
- One ground: unify `/app` + `/search` page background to `var(--bone)` family (kill the cool `#f6f9fc` flash between routes).
- Breakpoints: consolidate the 14 media-query widths to 4 (1200/960/760/560).
- Radii vocabulary: {4, 6, 8, 12, 999-badges-only}.
- `theme-color` meta in `root.tsx` is stale navy `#07111a` — set `#f4f1e8`.
- Contrast: darken `--ld-ink-faint #8e8878` → `#6e6a5e` (small text on bone was ~3.1:1); floor functional labels at 11px.
- Remove the unloaded-Roboto reference on `.f9-oauth-button` (use `inherit`).

**Acceptance:** distinct hex count < 30; `@media` widths ∈ {4 values}; all non-decorative text ≥4.5:1 (spot-check the flagged selectors); theme-color matches page ground.

---

## PHASE C — RETENTION LOOP & EMAILS

### WP-19 [P0] Send a "we hit a problem" email when all scans fail

**Files:** `app/lib/digest-orchestration.server.ts`, `app/lib/monitoring.server.ts` (anchor: the heartbeat guard requiring `runStats.runs > 0`), `app/lib/digest-email.server.ts`

Today a digest period with ≥1 active watchlist, 0 events AND 0 successful runs sends **nothing** — the customer's product goes silent exactly when it's broken (the operator gets an at-risk email; the customer doesn't). Churn is decided on that silence.

**Change:** in that branch, build a new template `buildScanTroubleEmail` (place beside `buildQuietDigestEmail`): subject "We hit a problem checking your competitors", body lists the affected watchlists, states retries are running automatically, links `/app/watchlists`. Reuse the digest-period idempotency key pattern (`scan_trouble:<userId>:<period>`), gate to paid plans, respect unsubscribe.

**Acceptance:** unit test — period with active watchlists + 0 successful runs → exactly one `scan_trouble` delivery attempt; ≥1 successful run → current heartbeat unchanged; free plan → nothing; re-run of the same period → no duplicate.

### WP-20 [P1] Instant alerts: default on, and let the exciting events through

**Files:** `app/lib/data/delivery-records-workspace.server.ts` (anchor: `instantEnabled: false`), `app/routes/app.watchlists.tsx` (form default), `app/lib/delivery-policy.server.ts` (thresholds, balanced=75), `app/lib/watch-event-evaluator.server.ts` (base scores)

Instant alerts are off by default, and at the default "balanced" threshold (75), `ad_new` scores 65 and `landing_page_offer_changed` scores 74 — the two headline events ("new ad", "price change") can **never** fire instantly. The product's core promise is structurally muted.

**Change:** (1) default `instantEnabled: true` for new paid workspaces (existing workspaces keep their stored value; quiet hours default stays 22–08). (2) Raise base scores: `landing_page_offer_changed` 74→80, `ad_new` 65→76. Update the score-comment table.

**Acceptance:** tests — confirmed `ad_new` and offer-change events at balanced sensitivity produce an instant batch; new-workspace config snapshot has instant on; suppression window still applies.

### WP-21 [P1] Digest frequency preference (the email already promises it)

**Files:** new migration, `app/lib/data/delivery-records-workspace.server.ts`, `app/routes/app.notifications.ui.tsx`, `app/lib/digest-orchestration.server.ts`, `app/lib/digest-email.server.ts`

Every digest links "Manage frequency in Notifications", but `/app/notifications` has no frequency control — cadence is plan-fixed. A Starter user gets a daily email (including daily "All quiet" heartbeats) with no way to opt down except disabling digests or unsubscribing — the two worst retention outcomes. The promise in the email is currently **false**.

**Change:** add `digest_cadence_preference TEXT NOT NULL DEFAULT 'plan_default'` (`plan_default` | `weekly_only`) to the workspace delivery config table via a new migration; a select on `/app/notifications`; skip daily digest jobs for `weekly_only` users in the orchestration enqueue. Also add a heartbeat auto-degrade: after 3 consecutive daily all-quiet heartbeats, collapse to weekly until movement resumes (counter can live in the digest run metadata — no new table).

**Acceptance:** starter user set to `weekly_only` gets no daily job; default preserves current behavior; 4th consecutive quiet day sends nothing under degrade; movement resets it; the notifications page persists the setting.

### WP-22 [P1] Kill the Monday double-digest

**Files:** `workers/schedule.ts`, `app/lib/digest-orchestration.server.ts`

Daily brief (04:00 daily) + weekly digest (Monday 05:00) → Starter/Agency users get two overlapping digests an hour apart every Monday.

**Change:** when enqueueing the daily digest, skip users whose plan also receives the weekly on Mondays (`new Date(scheduledTime).getUTCDay() === 1`); the weekly opens with "including your Monday brief".

**Acceptance:** Monday scheduledTime creates no daily job for a daily+weekly user, still creates the weekly; other days unchanged.

### WP-23 [P1] Bring instant alert emails up to digest intelligence

**Files:** `app/lib/delivery.server.ts` (anchor: `buildInstantAlertContent`), `app/lib/change-intelligence.ts`

The digest renders priority band, evidence class, recommended next action, trends, before/after thumbnails; the instant alert renders title/summary/diff/one image/one link. The intelligence layer (`buildChangeIntelligenceSummary`) simply isn't called on the instant path.

**Change:** call it per event in both instant variants (single + batched); render "Suggested next action" + priority band under the diff; include advertiser label when present.

**Acceptance:** snapshot tests of both variants include action + priority; HTML-escaping tests pass; subjects and idempotency unchanged.

### WP-24 [P1] Deep-link emails to the actual change

**Files:** `app/routes/app.watchlists.tsx` (loader + component), `app/lib/delivery.server.ts`, `app/lib/digest-email.server.ts`

Alert links land on `/app/watchlists?watchlist=<id>`; every digest item links the same digest page. The click-through moment lands on a list, not the change.

**Change:** support `?event=<eventId>` on the watchlists route — scroll to and highlight that event row (a `:target`-style highlight class is fine). Use it in alert links and digest top-move items.

**Acceptance:** route test for the loader param; template tests show per-item URLs carrying `event=`.

### WP-25 [P1] Welcome email + free activation-result email

**Files:** `app/lib/delivery-account-emails.server.ts`, hook into verification completion and the baseline event path in `monitoring.server.ts` (anchor: the baseline event creation)

There is no welcome email, and a free user's activation scan produces a baseline event that is delivered **nowhere** (free has no digests; instant defaults off). Free users literally never hear from the product after signup.

**Change:** (1) on email verification completion: one welcome email — what happens next, when the first scan lands, link to the watchlist. (2) on a free user's first successful activation scan: one email — "Your activation scan found N ads for {competitor}" with 2–3 top ads (text + thumbnail if WP-01 landed) and the upgrade line ("Paid plans keep watching and email you when things change"). Both idempotent via `delivery_attempt` keys; no recurring sends to free.

**Acceptance:** exactly-one semantics tested for both; free user receives no other recurring email; unsubscribe honored.

### WP-26 [P2] Monthly customer recap

**Files:** `app/lib/monitoring.server.ts` (operator weekly-numbers path shows the query patterns), new template in `digest-email.server.ts`

Customers never see "what you got this month" — the artifact needed the day before renewal.

**Change:** on the first Monday cron of each month, per paid user: changes caught, evidence captured, checks used vs included, top competitor by activity. Skip when zero activity. Idempotency `recap:<userId>:<yyyy-mm>`.

**Acceptance:** one recap per month; numbers reconcile with `/app/billing` usage.

### WP-27 [P2] Digest content upgrades

**Files:** `app/lib/digest-email.server.ts`

Top moves capped at 3, ungrouped. Raise to 5, group by watchlist name with per-group counts, keep 220-char summaries and accurate omitted counts.

**Acceptance:** digest with 8 events across 3 watchlists renders ≤5 items grouped; counts correct.

### WP-28 [P2] Ad-copy change detection (creative refresh events)

**Files:** `app/lib/monitoring.server.ts` (anchor: `diffWatchlistObservations`), `app/lib/watch-event-evaluator.server.ts`

Observations already persist `hook`/`offer` per ad but are never diffed — a competitor rewriting a running ad's creative produces no event. Add comparison of `hook`/`offer` for ads present in both baseline and current, emitting an event with before/after metadata (ride an existing CHECK-constrained event type via `metadata.kind: "creative_copy"` if adding a new type requires migration work you can't verify). Also collapse ≥5 `ad_new` events in one run into a single "N new ads launched" event to prevent alert walls.

**Acceptance:** unit test — changed hook → one event with before/after; suppression applies; digest renders the diff; 6 new ads → 1 aggregate event.

### WP-29 [P2] Retention hygiene set

**Files:** various

1. Delete dead code: module-private `runDigests` (~370 lines in `monitoring.server.ts`) and the obsolete `renderDigestHtml` in `delivery.server.ts` (keep the Slack sibling). Grep confirms no references; tests green.
2. Presence digest email: pass a real unsubscribe URL and the standard shell before presence ever goes GA (anchor: `unsubscribeUrl: null` in the presence path).
3. `hasIndiaSignal` +10 importance bump for ₹/COD/EMI (in `watch-event-evaluator.server.ts`) violates global-first — generalize to any currency/purchase signal or delete. Score-parity test between ₹ and € price changes.
4. Starter share links: give Starter watermarked share links ("Made with Five to Nine") while keeping unbranded/PDF/client-reports Agency-only — sharing is free acquisition. Entitlement change + template conditional + plan-matrix test update.

---

## PHASE D — CONVERSION FUNNEL & MARKETING [CODEX-OVERLAP on marketing.tsx, pricing.ts, compare.magicbrief.tsx]

Re-read current file contents before each package here; Codex may have shifted copy.

### WP-30 [P0] Kill the hedge copy at conversion points

**Files:** `app/routes/marketing.tsx`

Three spots undercut trust with conditionals about the product's own core feature (monitoring IS live in prod):
1. Final CTA note (anchor: `can run scheduled checks when monitoring is active`) → "Public search preview is free — no account. Paid plans run scheduled checks every 3–6 hours and email you the proof."
2. How-it-works steps (anchor: `When scheduled monitoring is active on your paid plan`) → declarative: "Five to Nine checks their ads, offers, CTAs, and forms every 3–6 hours on paid plans…" / step 3 → "Your brief groups meaningful changes… — daily on Starter and Agency, weekly on Scout."
3. Hero announcement pill subtext (anchor: `Provider coverage and freshness vary`) → "Paste a competitor site — no account needed." (Coverage caveats stay inside `/search` where they're contextual.)

Cadence claims must match `app/lib/plan-entitlements.ts` (6h Scout, 3h Starter/Agency).

**Acceptance:** no "when … is active" phrasing remains on the landing; claims match entitlements; tests pass.

### WP-31 [P1] Fix SSR pricing placeholders

**Files:** `app/routes/marketing.tsx`, `app/lib/pricing.ts`

Server HTML always ships `"Monthly price loading"`, and the monthly-cycle small-print interpolates into the literal string **"Annual price loading annual"**. Crawlers, link previews, slow networks, and any pricing-API failure see a broken pricing section at the money moment.

**Change:** fallback labels → neutral copy ("Localized at checkout" / "Billed annually — 4 months free"); when the client fetch fails (currently a swallowed `.catch`), render "Prices load in your local currency at checkout" instead of the placeholder; never interpolate a fallback label into the "annual" small-print.

**Acceptance:** rendered HTML never contains "price loading"; a vitest snapshot/regex test enforces it.

### WP-32 [P1] Refund policy + product FAQ + free card

**Files:** `app/routes/marketing.tsx`, `app/routes/terms.tsx`, `app/lib/pricing.ts`

1. **Refund disclosure** (currently absent everywhere — a trust and dispute liability): add a pricing-FAQ entry and a matching Terms block. Policy: purchases final (digital product with a free public preview to evaluate first), 100%-satisfaction support promise via support@0509.io, cancellation stops future renewals with access through the paid period. No "money-back guarantee" language.
2. **Product FAQ block** (same component pattern as the billing FAQ): data source (public Meta Ad Library + public landing pages), legality (public data only), stealth (competitors aren't notified), difference vs ad-spy tools (change-monitoring + evidence vs creative-volume browsing), alert speed (3–6h checks by plan; instant alerts Starter+).
3. **Free card** in the pricing grid (static, no Dodo dependency): "Free — ₹0/$0", features: public search preview; 1 saved watchlist; first scan + baseline; upgrade anytime. Rewrite the jargon note ("one activation watchlist and its first baseline only") into plain language.
4. Scout feature-list dedupe in `pricing.ts`: remove "Sample competitor brief before signup" (true of everyone) and the duplicate weekly-digest line.

**Acceptance:** "refund" appears on `/` and `/terms`; 4 cards render; no jargon strings remain; no feature on a paid card is also free.

### WP-33 [P1] Re-aim the hero at the real buyer

**Files:** `app/routes/marketing.tsx`

The H1 price-drop story sells to sales teams; the product (Boards, creative analysis, Agency plan, MagicBrief migration) is bought by marketers/agencies. Keep the distinctive price-cut wall; retarget the deck: "Your team would've found out from a client. Five to Nine watches competitors' Meta ads and landing pages, saves the screenshots, and files the brief — before your alarm goes off." Update the meta description to match (marketing teams and agencies, Meta ads + landing pages + screenshot evidence).

**Acceptance:** first viewport names the audience and mechanism; og/twitter description matches.

### WP-34 [P2] Trust & SEO set

**Files:** `app/routes/status.tsx`, `app/routes/changelog.tsx`, `app/lib/seo.ts`, `app/routes/search.tsx`, `app/root.tsx`, new compare route(s)

1. `/status`: state the "no live measurement" disclaimer once, then affirmative operational statements; "does not measure" appears at most once.
2. Changelog: add entries for shipped customer-visible work (it's a month stale — signals abandonment). Only verified shipped features.
3. Sitemap: add `/search` and `/auth/signup` to `SITEMAP_PATHS`.
4. JSON-LD: Organization + WebSite on `/`, FAQPage for the FAQ blocks. No hardcoded prices in markup.
5. Search page title → "Search competitor Meta ads free | Five to Nine".
6. Email-in-URL privacy: the hero email capture GETs `?email=` into the URL — drop the email input in favor of a plain CTA link, or move the value via sessionStorage.
7. Root ErrorBoundary offers "Go to homepage" alongside "Open app" (anonymous visitors currently get bounced to login).
8. One more compare page using the `compare.magicbrief.tsx` structure: "Five to Nine vs checking the Meta Ad Library by hand" (zero competitor-brand risk); link compare pages from the footer; shared footer component across marketing + compare pages.
9. Explain the name once on `/`: "Named for 05:09 — your competitor brief is filed before the workday starts."
10. Social proof, honest-only: a founder note section (needs operator input for name/photo — put a TODO placeholder structure in place, gated off until content exists), plus a "Built on the public Meta Ad Library" source-credibility line. Do NOT invent testimonials or numbers.

**Acceptance:** per-item; all new pages registered in routes + sitemap with `publicSeoMeta`; no unsourced claims.

---

## PHASE E — BILLING, MARGINS, COST CONTROL

Context from the unit-economics model (assumptions in the audit): Scout ~91% expected margin, Starter ~90%, Agency ~78% expected but **34% worst-case monthly and ~breakeven worst-case annual**. Search is the biggest unmetered spend lane.

### WP-35 [P1] Per-plan daily search budgets, fail-closed

**Files:** `app/lib/rate-limit.server.ts` (anchor: the authenticated-search bucket, 60/10min, `failClosed: false`), `app/routes/search.tsx`

A free account can theoretically drive ~8,640 live scrapes/day (≈$6–13/day of Browser Rendering), and the bucket fails open on rate-limit errors.

**Change:** add a plan-keyed daily bucket on top of the existing 10-min bucket: free 25/day, scout 100/day, starter 300/day, agency 1,000/day. Set the search buckets `failClosed: true`. Reuse the existing `atomicClaim` mechanics. On limit: a friendly in-product message with the reset time and an upgrade link (not a bare 429 page).

**Acceptance:** 26th live search on free in a UTC day is blocked with the labeled message; cached-result views don't consume the budget; tests in the rate-limit suite.

### WP-36 [P1] Cross-workspace discovery reuse for scheduled scans

**Files:** `app/lib/monitoring.server.ts` (anchor: `forceLive: true` in the scheduled-scan discovery call), `app/lib/discovery-cache.server.ts`

Scheduled scans always scrape live; the discovery cache keys by provider+fingerprint+country but scans bypass it, so 10 workspaces watching the same competitor pay 10×. This is the single biggest Agency-margin lever with zero customer-visible change.

**Change:** scheduled scans accept any cache entry fresher than the plan's cadence window (≤3h for 3h-cadence plans, ≤6h for Scout) regardless of which workspace produced it; scrape live only on miss, then populate the shared cache. Keep interactive-search freshness behavior unchanged. Preserve the stale-cache honesty rule: a stale-cache scan must never fabricate diffs (the existing guard stays).

**Acceptance:** two workspaces watching the same fingerprint within the window trigger one live scrape (test with the cache mocked); diff correctness tests unchanged; per-workspace observations still recorded.

### WP-37 [P1] Agency priority scan slots (margin backstop)

**Files:** `app/lib/plan-entitlements.ts`, `app/lib/monitoring.server.ts` scheduling gate (anchor: `shouldSchedulePlanInRegularScan`), marketing/billing copy that states "75 competitors checked every 3 hours"

Worst-case Agency (75 watchlists × 8 scans/day) costs ~$92/mo against ~$138 net monthly (~$92 net annual). Tier the cadence: first 25 watchlists at 3h ("priority scan slots"), watchlists 26–75 at 6h. Add `priorityScanSlots: 25` to agency entitlements; schedule non-priority watchlists only on 6h-aligned runs. Update every copy surface that promises 75×3h to the honest "25 priority slots at 3-hour checks; every competitor at least every 6 hours" framing. **Copy changes here are [CODEX-OVERLAP].**

**Acceptance:** a simulated 75-watchlist Agency workspace schedules at most 400 scan attempts/day before WP-36 reuse (12,000 in a 30-day month; 12,400 in a 31-day month), and live scrapes never exceed scheduled attempts; shared-cache reuse should make the live-scrape total lower without being required for the deterministic ceiling. Copy matches behavior everywhere (marketing, pricing bullets, billing FAQ); plan-matrix tests updated.

### WP-38 [P2] Billing correctness details

**Files:** `app/lib/evidence-usage-policies.server.ts`, `app/lib/billing-reconcile.server.ts`, `app/lib/monitoring.server.ts`, `app/lib/plan-entitlements.ts`, `app/lib/pricing.ts`

1. **Partial-refund proration:** a partial refund currently claws back ALL remaining top-up credits (anchor: `topUpRefundQuantityAdjustment`). For `partial` with amounts present, compute the cumulative target clawback from the original granted quantity: `round(originalGrantedQuantity × cumulativeRefundedAmount/paymentAmount)`. Subtract credits already clawed back, then remove `min(remaining, max(0, targetClawback - alreadyClawedBack))`; dedupe repeated refund events. Unit tests: a half-refund leaves half of 100 unspent credits, and two distinct 25% refunds leave 50 rather than 56.
2. **Fail-open plan default:** `getProofCapturePlan` defaults to `"starter"` when the DB binding is absent — change to `"free"`.
3. **Scout/Starter evidence-gap:** `landing_page_evidence` is Starter+ on paper but enforced nowhere; Scout's 50 checks buy identical screenshot proof. Resolve by *keeping* the behavior and making it honest: add the landing-page-evidence bullet to Scout's pricing features. **[CODEX-OVERLAP]** on pricing.ts.
4. **Annual-validation drift signal:** the annual toggle silently disables when Dodo's annual price ≠ 8×monthly. Add per-plan `annualValidation.reason` to the weekly operator business-numbers email so drift alarms.

---

## PHASE F — ONBOARDING & ACTIVATION

### WP-39 [P1] First-email expectation + signup sent-state recovery

**Files:** `app/routes/app.watchlists.tsx` [CODEX-OVERLAP], `app/routes/auth.signup.tsx`, `app/components/auth-form.tsx`

1. A Scout buyer's first email can be ~7 days away (weekly digest) and nothing says so. In the watchlist delivery section and the post-creation banner, render "First digest: {computed next digest date} to {account email}" from plan cadence + workspace timezone (WP-25's welcome/first-scan emails close the rest of the gap).
2. The magic-link "sent" state (anchor: `?sent=1`) has no resend or wrong-email affordance — the riskiest step of the funnel has no recovery. Render a sent-state card: target email in bold, "Resend link" button, "Use a different email" link.

**Acceptance:** new Scout user sees a concrete first-digest date; sent-state has one-click resend and edit paths.

### WP-40 [P1] Fix the free-user collections dead end + first-scan banner staleness

**Files:** `app/routes/search.tsx`, `app/routes/app.watchlists.tsx` [CODEX-OVERLAP]

1. Signed-in free users clicking "save ad" are told to create a collection, then hit "Collections start on the Scout plan" two clicks later. Show the plan gate inline in search instead: "Saving ads to a collection starts on Scout" → `/app/billing?source=search#plans`.
2. `FirstScanBanner` polls 4s×30 then permanently shows "delayed" even if the scan finishes at minute 3. After the cap: render a "Check now" revalidate button and back off to 30s polling for up to 10 more tries.

**Acceptance:** free user sees the gate without navigating; a scan finishing at minute 4 reflects without a manual refresh.

### WP-41 [P2] Onboarding value preview + copy alignment

**Files:** `app/routes/app.onboard.tsx`, `app/lib/market-desk-brief.ts`, `app/routes/app.dashboard.tsx`, `app/lib/dashboard-navigation.ts`, `app/routes/app.digests.tsx`, `app/routes/app.shares.tsx`

1. The onboard page is a bare URL form. When the competitor field holds a valid domain, promote "Search first instead" to a visible secondary button carrying the typed website, and show cached search results inline when the cache is warm (reuse the warm-cache check used by search).
2. Free-path copy says "queue its first evidence scan" but free has zero evidence checks — say "first scan" on free surfaces; reserve "evidence" for plans with proof budget.
3. Terminology: nav says "Briefs", the page says "Digests", the dashboard says "Market Desk Brief". Pick one ("Briefs" recommended) and align nav label + page H1.
4. Render the existing-but-unused `WakeGreeting` component in the dashboard header (or delete it and its sibling `formatTrackingStatusSummary` — do not leave dead code).
5. Onboarding cap copy recommends only Starter — mention "Plans start with Scout" while keeping Starter recommended.
6. Shares empty state: add the missing `action` prop ("Open reports" → `/app/reports`).
7. Reuse `ProofGlossary` on the watchlist detail so "activation scan", "evidence check", "digest" are defined where first met.

**Acceptance:** per-item; no dead components remain; nav label matches page H1.

---

## PHASE G — REMAINING POLISH (after everything above)

- **WP-42 [P2]** Optimistic UI: watchlist pause/resume and collection saves via `useFetcher` with in-row pending (`SubmitButton` supports `match`) — no global route-progress flash for row actions.
- **WP-43 [P2]** Skip-to-content link before the 13-link rail; style active nav via `[aria-current="page"]`.
- **WP-44 [P2]** Date filters: `firstSeenFrom`/`lastSeenFrom` exist in `SearchFilters` and are enforced server-side but have no UI — add two date inputs to the Refine panel, or delete the dead plumbing.
- **WP-45 [P2]** Demo-mode per-card labeling: when `ad.source === "demo"`, render a small "Sample" badge on the card (panel-level label already exists).
- **WP-46 [P2]** Mobile landing: the hero has no visual proof artifact ≤760px (`.ld-intel` is display:none'd) — keep the lightweight brief-strip visible above the fold.
- **WP-47 [P2]** OCR script filter excludes Arabic/CJK/Cyrillic creative text (anchor: the candidate regex in `creative-text.server.ts`) — extend to the same script set as `language-classifier.ts`.
- **WP-48 [P2]** Dark mode for `/app` only — do this LAST, after WP-12/14/15/16/18 make it a ~30-token override. Brand-coherent ("we work while you sleep") but pointless on the current broken token layer.

---

## OPERATOR ACTIONS (Nish — not for the coding model)

1. **Dodo webhook (revenue-correctness, do this first):** live endpoint `ep_3DyWwxkqJjUoAInxV07esfVvUDb` currently subscribes to only 8 events, but the handler also branches on `subscription.plan_changed`, `subscription.updated`, `payment.failed`, `payment.cancelled` — cancellation reversals, dunning-on-payment-failure, and checkout-failure clearing silently never fire. Also its URL is still `https://0509.in/api/webhooks/dodo` (legacy domain) — repoint to `https://0509.io/api/webhooks/dodo`. Both changes in the Dodo dashboard; verified via API on 2026-07-18.
2. Dodo dashboard: customer-portal "Allow Subscription Updates" toggle (still pending; self-serve cancel depends on it).
3. UptimeRobot (or similar) monitor on `/api/health` (still pending per docs/ops-backup-uptime.md).
4. Founder-note content for WP-34 item 10 (name, one paragraph, optional photo).
5. Check-pack unit prices on the Dodo dashboard: keep ≥ ~10× marginal cost (currently fine at ₹3.3–6/check vs ~₹0.1–0.2 cost).
6. Decide: Slack GA (code path is complete and dormant; highest-value channel for Agency ICP; needs a live webhook E2E proof + flag flip) — cheaper than WhatsApp Meta-side setup.
7. Decide: Agency annual pricing (currently pay-8-months; worst-case heavy user ~breakeven — consider pay-9 or rely on WP-36/37 cost cuts).

---

## WHAT NOT TO BREAK (verified strengths — regression-test territory)

- Billing webhook idempotency/ledger/monotonic ordering (no double-grant or missed-revoke path found — keep the tests green).
- Honest failure semantics everywhere: no demo fallback on live failure, stale-cache scans never fabricate diffs, "no proof, no claim".
- The first-scan activation loop (scan queues on creation from all three entry points).
- Plan walls as upgrade prompts with `source=` attribution.
- Email shell: dark-mode-safe wrapper, `List-Unsubscribe`, idempotency keys.
- The landing page's distinctive art direction (ticker, editorial type, evidence artifacts) — Phase D changes copy and structure, not the design language.
- Two-step destructive confirms, skeleton loaders, reduced-motion coverage, 44px touch targets, print styles.
