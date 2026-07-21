# Five to Nine — Coherence Spec (Intent-Audit remediation, parts a + b)

**Date:** 2026-07-21 · **Author:** Reviewer/coordinator (Claude) · **Consumer:** an implementation agent (Cursor Composer / Grok / similar)

Source findings: `docs/INTENT-AUDIT-2026-07-21.md` (systemic failures SF-1 … SF-7). Design yardstick: `DESIGN.md` (two systems — public "Caught in the act" bone/green/Bricolage; workspace Vercel-calm). This spec covers the audit's **part (a) quick coherence fixes** and **part (b) component-level per-page intent redesigns** only. Part (c) ground-up redesigns (`/ads/*` template, first-run journey, richer upsell surfaces) are **out of scope** — they go through the Mobbin references → 3-directions design ceremony with the owner and are NOT specced here.

---

## 0. BASE BRANCH + COLLISION GATE (read first, every session)

> **DO NOT START ANY WORK PACKAGE IN THIS SPEC UNTIL `integration/polish-stack-2026-07-21` HAS MERGED TO `main`.**
> Every anchor string below was extracted from `integration/polish-stack-2026-07-21` (HEAD `e6f1634` at authoring time), **not** from `main`. That branch restructures `app/routes/app.watchlists.tsx` into `app/components/watchlists/*`, adds `app/components/pill.tsx`, `app/components/marketing-footer.tsx`, `app/components/public-doc-shell.tsx`, and reworks the changelog, empty-state, and dashboard-navigation systems. Starting against `main` will produce anchors that do not exist and rework that has already shipped.

1. Before your first package: `git fetch && git log --oneline -5 origin/main` and confirm a commit that merges `integration/polish-stack-2026-07-21` exists (or ask the operator). Branch every package from the latest `origin/main`.
2. **One work package per branch/PR.** Never bundle. Name branches `spec/wp-XX-short-name`.
3. **Verification loop for every package:** `npm test` and `npm run build` must pass before a package is done. Add/adjust the tests each package names. **Never weaken or delete an existing test to make a change pass** — if a snapshot/string assertion must change because the copy legitimately changed, update the assertion to the new intended string; if you cannot do that safely, STOP and flag it.
4. **Never run `npm run deploy`.** Deploys happen via CI on merge to `main`.
5. **Guardrails that apply to every package in this spec:**
   - **No route renames.** Keep every existing path (`/app/watchlists`, `/app/digests`, etc.). Naming changes are *display copy only* — never rename routes, files, exports, function names, DB columns, idempotency keys, or query params.
   - **No data-model changes.** No migrations. This is a pure UI/copy/component coherence pass.
   - **Translations/voice preserved.** The language classifier, translation fallbacks, and non-English label pipeline are untouched. New copy must match the landing page's confident-honest voice (declarative, no hedging, no jargon).
   - **Dark + light both.** The workspace defaults dark; public defaults light. Every visual change must render cleanly in both (`prefers-color-scheme` + the `data-theme` toggle). Verify both.
   - **Mobile intact.** No new horizontal scroll; existing breakpoints and 44px touch targets preserved.
   - **No new npm dependencies.** No Tailwind/CSS-in-JS. Pure CSS in `app/app.css`, icons via the existing inline `app/components/icons.tsx`.
   - **Honesty convention** unchanged: no unsourced claims, demo data stays labeled.
6. **Priority:** all packages here are **P1 polish** (conversion/retention coherence), none are P0 outages.

### What the integration branch ALREADY fixed (do NOT re-do)

Verified present on the branch — treat as done, only extend where a package explicitly says so:

- **Nav spine partly chosen:** `app/lib/dashboard-navigation.ts` sidebar already uses **"Competitors"** (`/app/watchlists`) and **"Briefs"** (`/app/digests`). `/app/digests` page is already titled "Briefs".
- **Shared footer exists:** `app/components/marketing-footer.tsx` (`MarketingFooter`) is used by both compare pages.
- **Shared legal/doc shell exists:** `app/components/public-doc-shell.tsx` (`PublicDocShell` / `PublicDocHeader` / `PublicDocFooter`) is used by help/docs/changelog/trust/terms/privacy/status.
- **Shared `EmptyState`** (`app/components/empty-state.tsx`) with `panel` / `inline` / `row` variants already exists (`IconEmpty`, `role="status"`).
- **Shared `Pill`** (`app/components/pill.tsx`) with `status` / `longevity` / `angle` variants exists.
- **Changelog is current:** `app/routes/changelog.tsx` already has a `2026-07-20` block. WP-A4 changelog work is reduced to a verification pass (see WP-A4).
- **Overview header carries no top-right action** and already renders `WakeGreeting`; the setup checklist is already `.slice(0, 5)`.

### Recommended execution order (by dependency)

`WP-A1` → `WP-B2` → `WP-B1` → `WP-B3` → `WP-A3` → `WP-A2` → `WP-A4` → `WP-B4`.

### Shared-file coordination table (land in this column order; later WPs rebase)

| File | WPs touching it | Ownership split |
|---|---|---|
| `app/routes/app.watchlists.tsx` | A1, B2 | A1 = title/heading strings (meta, `DashboardPageHeader title`, `<h2>Tracking desk</h2>`, comments). B2 = the two `EmptyState` blocks only. |
| `app/routes/app.digests.tsx` | A1, B2 | A1 = confirm noun (mostly done). B2 = the two `EmptyState` blocks. |
| `app/routes/app.dashboard.tsx` | A1, B3 | A1 = the `Market Desk` string swaps only. B3 = hero/checklist structure + CTA dedup. Land A1 first. |
| `app/routes/app.shares.tsx` | A3, (B2 excludes it) | A3 owns BOTH the header action and the empty-state CTA target. B2 must NOT touch this file. |
| `app/routes/marketing.tsx` | A1, A2, A4, B4 | A1 = `Sample Market Desk Brief` + digest→brief noun. A2 = header nav swap. A4 = plan badge. B4 = mid-page rhythm. Land A1 → A2 → A4 → B4. |
| `app/app.css` | B1, B2, A4, B4 | Additive class blocks only; each WP adds its own selectors, no shared-line edits expected. |
| `DESIGN.md` | A3, A4 | A3 documents the header-action rule; A4 documents the badge-color rule. Different sections. |

---

# PART (a) — QUICK COHERENCE FIXES

## WP-A1 [P1] One naming spine (SF-1)

**Goal:** one canonical customer-facing name per concept, enforced across sidebar, page titles, card headings, empty states, pricing, marketing, and the customer-visible email noun. Least-churn decision (the spine is already ~70% chosen on the branch):

| Concept | Canonical name | Retire | Keep as internal (do NOT rename) |
|---|---|---|---|
| The competitor-tracking surface | **Competitors** | "Watchlists" (as a *title*), "Tracking desk" | route `/app/watchlists`, `watchlist` param, all `watchlist*` identifiers, DB, functions |
| The periodic email summary | **Brief / Briefs** | "Digest(s)" in customer copy | route `/app/digests`, `digest*` functions/types/columns/idempotency keys |
| The Overview dashboard summary block | **Overview** (the page) / "your brief" (the content) | "Market Desk" | `market-desk-brief.ts` file/exports |
| The Presence subsystem | **Presence Desk** (KEEP — it is applied deliberately and consistently across all `/app/presence*` surfaces) | — | — |

**Rationale:** "Competitors" and "Briefs" already own the sidebar + one page title each; "Presence Desk" is coherent on its own subsystem. Only "Market Desk" and "Tracking desk" are half-applied — retire those two.

**Files + exact anchor strings + edits:**

1. `app/routes/app.watchlists.tsx`
   - Line 110 anchor: `export const meta = () => [{ title: "Watchlists | Five to Nine" }];` → `"Competitors | Five to Nine"`.
   - Line 1058 anchor inside `<DashboardPageHeader … title="Watchlists" />` → `title="Competitors"`.
   - Line 1090 anchor: `<h2>Tracking desk</h2>` → `<h2>Competitors</h2>`.
   - Line 961 anchor (comment): `// Workflow-friction pass: bulk pause/resume from the tracking desk.` → `…from the competitors list.`
   - Leave the `Selected watchlist` kicker (line 1177) as-is — "watchlist" as a per-row noun is acceptable; do NOT churn it. (The concept name is "Competitors"; a single tracked entity may still be a "watchlist" internally. If you prefer, change the kicker to `Selected competitor` — allowed but optional.)

2. `app/components/watchlists/bulk-select-bar.tsx`
   - Line 1 anchor (comment): `// Workflow-friction pass: bulk pause/resume from the tracking desk.` → `…from the competitors list.`

3. `app/routes/app.dashboard.tsx` (coordinate: land A1 before B3)
   - Line 695 anchor: `<h2>Keep the Market Desk useful</h2>` → `<h2>Keep your overview useful</h2>`.

4. `app/routes/app.onboard.tsx`
   - Line 534 anchor: `name: \`${input.row.client} Market Desk\`,` → `name: \`${input.row.client} watch\`,` (this string becomes the auto-generated watchlist name — keep it short and neutral).

5. `app/routes/marketing.tsx`
   - Line 651 anchor: `<h2>Sample Market Desk Brief</h2>` → `<h2>Sample morning brief</h2>`.
   - Line 137 anchor (FAQ answer): `…instead of waiting for the digest.` → `…instead of waiting for the brief.`

6. `app/lib/pricing.ts` (the plan feature strings)
   - Line 38 anchor: `features.push("Weekly Digest");` → `features.push("Weekly Brief");`
   - Line 40 anchor: `features.push("Daily + weekly Digests");` → `features.push("Daily + weekly Briefs");`
   - Line 48 anchor: `features.push("Saved competitor research", "Email digest delivery");` → `…, "Email brief delivery");`
   - Line 18 anchor `"Sample competitor brief before signup"` — already "brief", leave (WP-A4 item 4 handles Scout dedupe separately; do not touch here).

7. `app/lib/public-markdown.ts` (feeds `/help` + `/docs`)
   - Line 35 anchor: `Competitor monitoring for growth teams (Market Desk) plus proof-backed entity tracking (Presence Desk).` → drop the parenthetical "(Market Desk)": `Competitor monitoring for growth teams plus proof-backed entity tracking (Presence Desk).` Leave every "Presence Desk" mention intact.

8. **Customer-visible email noun** — `app/lib/digest-email.server.ts` (bounded string-only change; keep all `digest*` identifiers):
   - The "View full digest" CTA label and "in the full digest" body noun → "View full brief" / "in the full brief". Locate by grepping the file for the visible strings `View full digest` and `full digest`.
   - The `subjectForDigest(...)` output noun and `buildQuietDigestEmail` subject (anchor line ~226 `` `All quiet: no competitor moves worth action ${quietPeriodLabel}${mondayBriefNote}` ``) already avoid the word "digest" — verify; only change a subject if it literally contains "digest".
   - **If** changing these breaks `tests/digest-email.test.ts` / `tests/digest-delivery-claims.test.ts` string assertions, update the assertion strings to the new intended copy (this is a legitimate copy change, not a test weakening). If a snapshot cannot be updated confidently, STOP and flag rather than guess.

**Guardrails:** route paths, `digest`/`watchlist` identifiers, function/type names, and idempotency keys are internal — never rename. Presence Desk stays. Do not touch the `Selected watchlist`→row semantics beyond the optional kicker note.

**Acceptance (behavioral + visual):**
- Grep of user-facing JSX text renders exactly one concept-word per concept: no visible "Tracking desk", no visible "Market Desk", no customer-facing "Digest"/"Digests" in nav/titles/headings/pricing.
- `/app/watchlists` shows "Competitors" in the browser tab, the page `<h1>`, AND the left-panel `<h2>` — three surfaces, one word.
- Pricing plan cards say "Brief"/"Briefs", matching the app nav and `/app/digests`.
- "Presence Desk" still appears intact on `/app/presence`.

**Tests:** update `tests/watchlists.route.test.ts` (title/heading assertions), `tests/pricing.test.ts` (feature-string assertions), `tests/digest-route-presentation.test.ts` if it asserts headings, `tests/help-runtime-truth.test.ts` / `tests/public-markdown.test.ts` (if they assert the "(Market Desk)" string), and the two digest-email tests per item 8. Run the full suite — several files assert these strings.

---

## WP-A3 [P1] CTA + currency coherence (SF-4/SF-5/SF-6)

Four independent fixes. (Runs after B3 so dashboard CTA dedup is B3-owned and does not collide.)

### A3.1 — `/app/shares` dead-end CTA

`app/routes/app.shares.tsx` currently points a Scout user at the Agency-paywalled Reports page from BOTH the header and the empty state.
- Line 98 anchor: `action={{ label: "Open reports", to: "/app/reports" }}` (in `DashboardPageHeader`). **Remove the header `action` entirely** (per the A3.4 header-action rule below — Shares has no page-level create action, so it carries none).
- Line 109 anchor: `action={{ label: "Open reports", to: "/app/reports" }}` (in the empty-state `EmptyState`). Change target to the page's real prerequisite action: `action={{ label: "Open competitors", to: "/app/watchlists" }}` and update the empty-state `title`/`description` so the teaching is truthful — a share link is created from a watchlist/collection/report, not from this page:
  - `title="No active share links"` (keep)
  - `description="Share a competitor, collection, or report from its own page and the link shows up here to revoke any time."`

### A3.2 — Overview competing add-competitor CTAs

Owned by **WP-B3** (see B3.2). A3 does not edit `app.dashboard.tsx`. This line exists only to record the cross-reference.

### A3.3 — In-app billing currency must match public pricing

**Root cause (verified):** `app/lib/dodo-pricing-country.server.ts::countryFromRequest` resolves the buyer country from `request.cf.country` and, **only when `trustProxyHeaders` is true**, also from the `cf-ipcountry` / `x-country` headers. `previewDodo0509PlanPrices` defaults `trustProxyHeaders = true` (`app/lib/dodo-pricing.server.ts` line ~209). The public `/api/pricing-preview` route calls it with the default (`{ env, request }` → `true`). But `app/routes/app.billing.tsx` line 150 calls it with an override:
```
return previewDodo0509PlanPrices({ env, request, trustProxyHeaders: false });
```
So the two surfaces resolve the buyer country differently — the public page can read `cf-ipcountry` and show ₹ INR while in-app billing falls back and shows $ USD for the same browser.

**Change:** in `app/routes/app.billing.tsx`, delete the `trustProxyHeaders: false` override so billing resolves the buyer country identically to the public preview:
```
return previewDodo0509PlanPrices({ env, request });
```
(Anchor to change: `previewDodo0509PlanPrices({ env, request, trustProxyHeaders: false })` at line 150.)

**Why this is safe:** this flag governs *currency display only*. It is NOT the auth-origin trust boundary — auth origin is separately pinned via `BETTER_AUTH_URL` in `wrangler.jsonc` and is unaffected. The billing route is already an authenticated, session-gated loader. Do NOT touch the other `trustProxyHeaders: false` call sites in `dodo-pricing.server.ts` (checkout validation, subscription currency) — those are intentionally strict and are not a display surface.

**Acceptance:** a single simulated request carrying `cf-ipcountry: IN` (or a mocked `request.cf.country = "IN"`) resolves the **same** currency from both `/api/pricing-preview` and the billing loader. Add a test asserting parity.

### A3.4 — Header-action rule (document + enforce)

**Rule (document in `DESIGN.md`, workspace section):**
> The `DashboardPageHeader` top-right `action` slot is reserved for the page's own single primary action (create/add for the resource that page manages) — or nothing. It is never a cross-navigation shortcut to another sidebar destination (those already live in the rail).

Audit the `action` prop on every `DashboardPageHeader` and REMOVE cross-nav shortcuts:

| File | Anchor `action` | Verdict |
|---|---|---|
| `app/routes/app.digests.tsx` | `action={{ label: "Open watchlists", to: "/app/watchlists" }}` | REMOVE (cross-nav) |
| `app/routes/app.collections.tsx` | `action={{ label: "Open search", to: "/search" }}` | KEEP — search IS how you add to collections; relabel to `"Add evidence"` pointing to `/search` (page's own primary action) |
| `app/routes/app.clients.tsx` | `action={{ label: "Notifications", to: "/app/notifications" }}` | REMOVE (cross-nav) |
| `app/routes/app.shares.tsx` | `action={{ label: "Open reports", … }}` | REMOVE (handled in A3.1) |
| `app/routes/app.notifications.ui.tsx` | `action={{ label: "Open digests", to: "/app/digests" }}` | REMOVE (cross-nav) |
| `app/routes/app.source-access.ui.tsx` | `action={{ label: "Open watchlists", to: "/app/watchlists" }}` | REMOVE (cross-nav) |
| `app/routes/app.developer-access.ui.tsx` | `action={{ label: "API docs", to: "/api/docs" }}` | KEEP — API docs is this page's own primary companion action; leave it. |
| `app/routes/app.presence.tsx` | `action={{ label: "Add from search", to: "/search" }}` | REMOVE — presence tracks declared sources, not search results (audit: off-topic here) |

**Guardrails:** removing an `action` prop must not break layout (the header already renders fine with no action — see `DashboardPageHeader`). No route changes.

**Acceptance (behavioral + visual):**
- `/app/shares` for a Scout user: header has no action; the single empty-state CTA points to `/app/watchlists` (reachable), not the Agency paywall.
- Billing and landing show the same currency symbol for one browser/geo.
- No `DashboardPageHeader` renders a cross-navigation shortcut; each remaining header action is that page's own primary action.
- `DESIGN.md` contains the header-action rule.

**Tests:** `tests/billing-page.route.test.ts` + `tests/dodo-pricing.server.test.ts` (currency parity — add the parity assertion); `tests/watchlists.route.test.ts` unaffected; add/adjust route tests for shares/digests/clients/notifications/source-access/presence header actions (`tests/clients.route.test.ts`, `tests/team-route-feedback.test.ts` neighbors). Grep-style guard test optional: assert no `DashboardPageHeader action` label matches the cross-nav blocklist.

---

## WP-A2 [P1] Unified public nav + footer (SF-2)

**Current state on the branch (three header variants):**
- Landing `app/routes/marketing.tsx` (line 492 anchor `<header className="ld-nav">`): links `Search preview` / `Sample brief` (`#demo`) / `Pricing` (`#pricing`) | `Sign in` / `{primaryLabel}`.
- Compare pages `app/routes/compare.magicbrief.tsx` (line 57) and `app/routes/compare.meta-ad-library.tsx` (line 79): inline-duplicated `<header className="ld-nav">` with `Search preview` / `Pricing` | `Sign in` / `Create account`.
- Legal/help/docs/changelog/trust/status via `PublicDocHeader` (`app/components/public-doc-shell.tsx` line 38): `Help` / `Docs` / `Status` / `Start`.

**Change — one shared header nav component:**

1. Create `app/components/marketing-nav.tsx` exporting `MarketingNav`:
   - Brand: `<Link className="ld-brand" to="/" aria-label="Five to Nine home"><BrandWordmark meta={MARKETING_TAGLINE} /></Link>`.
   - Primary links (in order): `Search preview` → `/search` · `Sample brief` → `/#demo` · `Pricing` → `/#pricing` · `Help` → `/help` · `Docs` → `/docs`.
     - Use `/#demo` and `/#pricing` (absolute-to-home hashes) so the links work from every page, not just landing.
   - Account links: `Sign in` → `/auth/login` · `Open app` → `/app` (single label everywhere — retire the "Create account" vs "Open app" split; "Open app" routes signed-out users through the auth gate anyway).
   - Reuse the existing `ld-nav` / `ld-nav-links` / `ld-nav-actions` / `ld-nav-pill` classes byte-for-byte (zero new CSS).
2. Replace the inline `<header className="ld-nav">…</header>` block in `marketing.tsx` (lines 492–511) with `<MarketingNav />`. On landing, `Sample brief`/`Pricing` may keep bare `#demo`/`#pricing` — but simplest is to let `MarketingNav` always use `/#…`; verify the landing in-page anchor still scrolls (React Router hash nav to same page is fine).
3. Replace the inline headers in both compare routes (`compare.magicbrief.tsx` lines 57–72, `compare.meta-ad-library.tsx` lines 79–94) with `<MarketingNav />`.
4. `PublicDocHeader` (legal/help/docs/changelog/trust/status): replace its nav link set (lines 45–50 anchor `<nav className="f9-search-nav-links" …>` with `Help`/`Docs`/`Status`/`Start`) with the same link set as `MarketingNav` so a visitor on `/terms` can reach Pricing, Help, and Docs. Keep the `f9-legal-nav` chrome/classes (the bone doc header styling + `tests/public-doc-header.test.ts` CSS contract must stay green) — only the link list changes. If matching the exact `MarketingNav` markup inside the legal shell is impractical, at minimum add `Pricing` (`/#pricing`), `Search preview` (`/search`), and `Sign in`/`Open app` to the doc header so no section is unreachable.

**Stabilize the wordmark tagline (SF-2):** pick ONE string and use it in every public `BrandWordmark meta=…`:
- Chosen: **`"Competitor change monitoring"`** (already used by `PublicDocHeader`; most literal/honest).
- `app/components/marketing-footer.tsx` line 18 anchor `<BrandWordmark meta="Market intelligence" />` → `meta="Competitor change monitoring"`.
- `marketing.tsx` line 494 `<BrandWordmark />` (no meta) and compare pages lines 81/59 `<BrandWordmark />` → use the shared `MARKETING_TAGLINE` via `MarketingNav`.
- Define `export const MARKETING_TAGLINE = "Competitor change monitoring";` in `marketing-nav.tsx` and reuse it in `MarketingFooter` and `PublicDocHeader` too (single source of truth).
- The app sidebar sub-label (`DashboardShell accountDetail`, e.g. "Competitor intelligence workspace") is a *workspace* label, not the public wordmark — leave it; it is a different context.

**Guardrails:** no route renames; keep all existing CSS class names; both compare pages keep `<MarketingFooter />` (already present). Internal links must stay React-Router `<Link>` (there is a `tests/internal-navigation.test.ts` that fails on raw `<a>` to internal paths). Dark/light: public is light-only by design — verify no regression. Mobile: `ld-nav` already collapses; adding two links must not overflow — verify at 375px (the nav wraps; acceptable, but check no horizontal scroll).

**Acceptance (behavioral + visual):**
- Identical nav link set on `/`, `/help`, `/docs`, `/changelog`, `/trust`, `/terms`, `/privacy`, `/status`, `/compare/meta-ad-library`, `/compare/magicbrief`.
- From any public page, Pricing, Help, Docs, and legal are reachable in ≤2 clicks.
- Every public `BrandWordmark` shows the same tagline string.
- No raw `<a href="/…">` internal anchors introduced.

**Tests:** extend `tests/public-doc-header.test.ts`, `tests/public-doc-routes.test.ts`, `tests/internal-navigation.test.ts`, `tests/compare-magicbrief.route.test.ts`, `tests/compare-meta-ad-library.route.test.ts`, `tests/marketing-rebuild.test.ts`, and `tests/funnel-seo.test.ts` as needed. Add one test asserting the shared nav link set appears on a landing render, a compare render, and a legal render.

---

## WP-A4 [P1] Content hygiene (SF-7)

Three small fixes.

### A4.1 — Changelog freshness (VERIFY, mostly done)
`app/routes/changelog.tsx` already has a `2026-07-20` `PublicDocBlock` covering the July releases (thumbnails, deeper search, dossier, dark mode, Cmd+K, free weekly watch, `/ads/:domain`, compare page, voice pass, perf). **Task = verify only.** Run `git log --oneline --since=2026-07-01 origin/main` after the integration branch merges; if any customer-visible feature shipped that is not represented in the 2026-07-20 block, add one honest bullet. Do NOT invent entries or list unverified/provider-gated work. `tests/changelog-customer-value.test.ts` asserts the honesty boundaries — keep it green.

### A4.2 — Badge / Pill semantics (green = state, accent = recommendation)

**Rule (document in `DESIGN.md`, one short paragraph):**
> Green (`Pill state="healthy"` / `--green` family) marks live STATE facts — "Current plan", "Active", "Running N days", "Healthy". A distinct ink-accent badge marks a RECOMMENDATION — "Recommended". Green never means "recommended"; the recommendation badge is never green. (Green stays the brand accent for state; the recommendation nudge uses the ink-filled emphasis so the two never collide on one screen.)

Current mismatch: billing greens "Current plan" (state — correct) but renders "Recommended" as a neutral pill; landing greens "Recommended". Make both agree on the rule.

- Add a badge modifier in `app/app.css` for the recommendation accent, e.g. `.f9-plan-badge` (landing) and a new `.f9-status-pill.is-recommended` (billing) both using an **ink-filled** treatment (dark bone-ink background, bone text) — visually distinct from the green `is-healthy` state pill. Reuse existing ink tokens; add no new hex outside the token sheet.
- `app/routes/app.billing.tsx`:
  - Line 525 anchor `<Pill state="healthy">Current plan</Pill>` — KEEP green (state). ✓
  - Line 527 anchor `<Pill state="healthy">Current tier</Pill>` — KEEP green (state). ✓
  - Line 529 anchor `<Pill>Recommended</Pill>` → `<Pill state="recommended">Recommended</Pill>` (ink-accent, not green, not neutral).
- `app/routes/marketing.tsx`:
  - Line 881 anchor `{plan.slug === "starter" ? <em className="f9-plan-badge">Recommended</em> : null}` — ensure `.f9-plan-badge` is the ink-accent treatment (NOT green). If it is currently green, restyle it to ink-accent so landing and billing match.
- Audit every other `Pill` / badge call site (grep `state="healthy"`, `f9-plan-badge`, `f9-status-pill`) and confirm none uses green for a recommendation or ink-accent for a live-state fact.

### A4.3 — De-India the default examples (global-first)
- `app/routes/search.tsx` line 1268 anchor: `placeholder="https://nykaa.com"` → geo-neutral placeholder `placeholder="https://competitor.com"` (or, if the loader already resolves the visitor's `cf-ipcountry`, a geo-aware sample — but the simple neutral placeholder is acceptable and matches the dashboard's `https://competitor.com`).
- `app/routes/app.collections.tsx` line 343 anchor: `<input name="name" placeholder="Nykaa competitors" required />` → `placeholder="Competitor set A"` (neutral).
- `app/routes/compare.meta-ad-library.tsx` line 84 + `app/routes/compare.magicbrief.tsx` line 62 anchors: `<Link to="/search?website=https%3A%2F%2Fnykaa.com">Search preview</Link>` → neutral `https%3A%2F%2Fexample.com` OR drop the prefilled `?website=` so the preview opens empty. Prefer dropping the query so no brand is implied. (After A2 these links live inside `MarketingNav`; apply the neutral value there.)

**Guardrails:** no route changes; keep `en-IN` number formatting where it is a *locale format helper* (e.g. `toLocaleString("en-IN")` in billing line 1291 is a display-format call, not an India default — leave it; global-first is about defaults/examples, not number grouping). Badge restyle must pass light + dark.

**Acceptance:**
- One documented badge-color rule in `DESIGN.md`; landing and billing both render "Recommended" in the same ink-accent, and green appears only on live-state pills.
- No `nykaa`/hardcoded-India example strings in search placeholder, collections placeholder, or compare preview links.
- Changelog verified current.

**Tests:** `tests/changelog-customer-value.test.ts` (keep green), `tests/billing-page.route.test.ts` (badge assertion if present), `tests/pricing.test.ts`. Add a grep-guard test asserting no `nykaa` in `app/routes/search.tsx`, `app/routes/app.collections.tsx`, and the compare routes.

---

# PART (b) — PER-PAGE INTENT REDESIGNS (component-level, within existing system)

## WP-B1 [P1] Shared LockedFeature gate component (SF-4)

**Goal:** one gate component replacing three inconsistent Agency-plan gates (Reports = neutral panel with CTA; Client rooms = **red error** aside with CTA; Team = neutral panel with **no CTA at all** — a dead end).

**Create `app/components/locked-feature.tsx`** exporting `LockedFeature`:
```
interface LockedFeatureProps {
  eyebrow: string;                 // e.g. "Reports"
  title: string;                   // e.g. "Client-ready reports"
  reason: string;                  // one line: why it's locked / what it does
  planNeeded: string;              // e.g. "Agency plan"
  upgradeTo: string;               // billing URL, e.g. "/app/billing?source=reports#plans"
  upgradeLabel?: string;           // default "Upgrade to Agency"
  seeExampleTo?: string;           // optional secondary "See an example" link
  seeExampleLabel?: string;        // default "See an example"
}
```
- Markup: `<article className="f9-app-panel f9-locked-feature" role="status" aria-labelledby>` with `<p className="f9-app-kicker">{eyebrow}</p>`, `<h1 id=…>{title}</h1>` (h1 for full-page gates; accept a `headingLevel` prop if a gate is embedded), `<p>{reason} — included in the {planNeeded}.</p>`, a **single** `<Link className="f9-primary-button" to={upgradeTo}>{upgradeLabel}</Link>`, and an optional secondary `<Link className="f9-secondary-button" to={seeExampleTo}>`.
- **Never red.** Add `.f9-locked-feature` CSS in `app/app.css` using the neutral/bone panel treatment (the reports gate is the reference look). Red (`is-error` / `--red`) stays reserved for diff-deletion/error semantics only.

**Roll out — exact anchors to replace:**

1. `app/routes/app.reports.tsx` lines 481–508 anchor (`if (data.accessDenied)` block, `<article className="f9-app-panel" … role="status">` … kicker "Reports" … h1 `Reports are included in the Agency plan.` … `Upgrade to Agency` button):
   ```
   <LockedFeature
     eyebrow="Reports"
     title="Client-ready reports"
     reason="Open client-ready reports and share the evidence with your team"
     planNeeded="Agency plan"
     upgradeTo="/app/billing?source=reports#plans"
     seeExampleTo="/compare/magicbrief"      // optional; or omit
   />
   ```

2. `app/routes/app.clients.tsx` — the `AgencyPlanNotice` function (lines 742–749 anchor `<aside … className="f9-message is-error">`, kicker "Agency feature", h2 `Client rooms are an Agency feature.`, button `Review Agency plans` → `CLIENT_ROOM_BILLING_URL`). Replace the whole `AgencyPlanNotice` body with `LockedFeature` (removing the `is-error` red):
   ```
   <LockedFeature
     eyebrow="Client rooms"
     title="Client rooms"
     reason="Keep watchlists, collections, reports, and client context together for agency delivery"
     planNeeded="Agency plan"
     upgradeTo={CLIENT_ROOM_BILLING_URL}
   />
   ```
   Also update line 469 anchor: the inline `is-error` message keeps its error styling only for genuine action errors — the `plan_gated` branch link `{actionData.error === "plan_gated" ? <Link to={CLIENT_ROOM_BILLING_URL}> Review Agency plans</Link> : null}` may stay (it is inside an action-feedback message, not the gate). Do not repaint genuine error feedback.

3. `app/routes/app.team.tsx` lines 196–228 anchor (the `<article className="f9-app-panel">` whose h2 is `Team seats come with Agency` and paragraph `Upgrade to the Agency plan to share your account with teammates.` with **NO** upgrade link). For the non-agency branch, render `LockedFeature` so the dead end gets a CTA:
   ```
   {data.plan !== "agency" ? (
     <LockedFeature
       eyebrow="Team"
       title="Invite your teammates"
       reason="Share watchlists, collections, and briefs with teammates — billing stays with you"
       planNeeded="Agency plan"
       upgradeTo="/app/billing?source=team#plans"
     />
   ) : ( …existing agency seat UI… )}
   ```
   Keep the agency-plan seat management UI (lines 214–299) exactly as-is for agency users.

**Guardrails:** no route/data changes; the three gates must become visually identical except copy/optional-example. Red removed from the client gate. No new npm. Light + dark.

**Acceptance (behavioral + visual):**
- Reports, Client rooms (non-agency), and Team (non-agency) render the SAME gate layout; each has exactly one working `Upgrade to Agency` primary CTA.
- Team is no longer a dead end.
- No gate uses the red/error color.

**Tests:** `tests/reports-index.route.test.tsx`, `tests/clients.route.test.ts`, `tests/team-route-feedback.test.ts`, `tests/e2e-j6-team.route.test.ts`. Update assertions that reference the old gate copy/`is-error`. Add a test: each gate route (non-agency) renders exactly one `f9-primary-button` with an `/app/billing…#plans` href and no `is-error` on the gate.

---

## WP-B2 [P1] Shared teaching EmptyState (SF-3)

**Goal:** kill the duplicate left+right empty-state rendering on Competitors and Briefs, upgrade the shared `EmptyState` to teach (headline + 2-line teach + primary action + optional "see a sample" link), and give each surface page-specific teaching copy. (Shares is excluded — its empty state is owned by WP-A3.1.)

**Component change — `app/components/empty-state.tsx`:** the `panel` variant already renders `IconEmpty` + heading + description + one action. Extend `EmptyStateProps` with an optional secondary sample link:
```
sample?: { label: string; to: string };   // optional "See a sample" secondary link
```
In the `panel` branch, after the primary `action` `<Link>`, render (when `sample` present) `<Link className="f9-secondary-button" to={sample.to}>{sample.label}</Link>` inside an `.f9-empty-actions` wrapper (add `.f9-empty-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }` to `app/app.css`). Keep `inline`/`row` variants unchanged. Keep `role="status"`, `IconEmpty`, and the existing dashed `f9-dash-state-empty` chrome (the audit calls it "generic", but replacing the icon/illustration is a part-(c) redesign; here we only stop the duplication and add teaching copy + a sample link).

**De-duplicate — Competitors (`app/routes/app.watchlists.tsx`):** two empty states fire when the workspace is empty:
- Line 1161–1168 anchor: the left-column list `EmptyState` (`title="Add your first competitor"`, `action` to `/search`, `headingLevel="h3"`).
- Line 1402–1406 anchor: the right-panel `EmptyState` (`title="Add your first competitor"`, `action` to `/search`).

Render only ONE. Keep the **right-panel** teaching card (it has room) and suppress the left-list card when there are zero watchlists — replace the left-list `EmptyState` (1161–1168) with a minimal `inline` hint or nothing, since the right panel already teaches. Concretely: change the left-list block to `variant="inline"` with a one-liner (`title="No competitors yet"`, no action), and make the right-panel the teaching card:
```
<EmptyState
  title="Add your first competitor"
  description="Paste your website or a competitor's — we scan their Meta ads and landing page, then email you the moment their offer, creative, or CTA changes."
  action={{ label: "Add competitor", to: "/search" }}
  sample={{ label: "See a sample brief", to: "/#demo" }}
/>
```

**De-duplicate — Briefs (`app/routes/app.digests.tsx`):** two identical `EmptyState`s fire:
- Line 289–295 anchor (left list, `headingLevel="h3"`, `title="Your first brief appears after monitoring runs"`).
- Line 505–508 anchor (right panel, `title="Your first brief appears after monitoring runs"`).

Keep ONE teaching card (right panel) and demote the left to an `inline` one-liner (or remove). Right-panel teaching copy:
```
<EmptyState
  title="Your first brief lands after the first scan"
  description="Add a competitor and we file a brief after each check — the moves worth acting on, and an honest 'all quiet' when nothing changed."
  action={{ label: "Add competitor", to: "/app/watchlists" }}
  sample={{ label: "See a sample brief", to: "/#demo" }}
/>
```

**Teaching-copy upgrade — Collections (`app/routes/app.collections.tsx`), no duplication to kill (list is `inline`, detail is `panel`):**
- Line 382–386 anchor (list, `variant="inline"`, `title="Nothing saved yet"`, `description="Collections you create with the form above appear here."`) — keep inline, tighten copy: `description="Saved competitor sets appear here."`
- Line 668–671 anchor (detail panel, `title="Create your first evidence collection"`, description ending `…with the create form.`) — rewrite to teach, drop "with the create form":
  ```
  description="Group a competitor's best ads, offers, and landing-page evidence in one place — ready to reuse in a report or share with your team."
  ```

**Voice:** confident-honest, declarative, second-person, no hedging — matches the landing ("Caught in the act"). No exclamation-mark hype.

**Guardrails:** `sample` link is optional and additive; existing `EmptyState` call sites without it are unchanged (byte-identical output — `tests/empty-state.test.ts` must stay green except where a new prop renders). Do NOT touch `app/routes/app.shares.tsx` (WP-A3 owns it). No new deps. Light + dark. Keep `role="status"`.

**Acceptance (behavioral + visual):**
- An empty workspace shows the "Add your first competitor" teaching card exactly ONCE on `/app/watchlists` (not twice); same for the brief card on `/app/digests`.
- Each teaching card has a headline, a 2-line teach, one primary action, and a "See a sample brief" secondary link.
- No empty state describes its own form ("with the create form" gone).

**Tests:** `tests/empty-state.test.ts` (add a case for the `sample` prop rendering a secondary link; keep existing cases green), `tests/empty-state-migration.test.ts`, `tests/watchlists.route.test.ts` (assert single empty card when zero watchlists), `tests/digest-route-presentation.test.ts` (assert single brief empty card), `tests/collections-route-feedback.test.ts`.

---

## WP-B3 [P1] Overview first-run hierarchy (SF-5)

**Goal:** one dominant next-action, the setup checklist demoted to a compact strip, no duplicate rows, competing add-competitor CTAs reduced to one primary + at most one secondary. (`app/routes/app.dashboard.tsx`. Land WP-A1 first — it renames "Market Desk"; B3 restructures the same region.)

**Current competing CTAs for the one first action (verified):**
- Free-first-run banner (lines 572–597): `View plans` primary + `Search competitors` secondary.
- Market-desk hero (lines 599–652): a `marketDeskBrief.action` primary button (line 606–611) AND a full search `<Form>` with a `Search ads` submit (lines 631–651) — two CTAs in one card.
- Setup checklist (lines 654–688): per-row action links.

### B3.1 — One dominant next-action card (first run)
For a fresh workspace (`plan === "free" && competitorCount === 0`, lines 572–597), the free-watch banner is the dominant card — good. But the hero directly below ALSO shows an action button + a search form. For the empty state, collapse the hero to a single dominant CTA:
- Keep the free-watch banner but reduce it to ONE primary CTA. Change line 585–594 so the banner has one primary `Add your first competitor` → `/search` and drop the redundant `View plans` secondary from the *first-run* banner (plans are one click away in the rail + billing; the first job is to add a competitor, not to pay). Result: `<Link className="f9-primary-button" to="/search">Add your first competitor</Link>` only.
- In the hero card (599–652), when `competitorCount === 0`, render EITHER the search form OR the action button — not both. Prefer the search `<Form>` (it is the actual add path) and drop the separate `marketDeskBrief.action` button for the empty state. When `competitorCount > 0`, keep the current hero (brief + action) as-is.

Net first-run CTAs: one dominant "add competitor" path (search box) + the free-watch context banner's single CTA. No four-way scatter.

### B3.2 — Demote the setup checklist to a compact progress strip
The `readinessGaps` panel (lines 654–688) is a full `f9-app-panel` with a 5-row `f9-work-list`. Demote it to a compact progress strip:
- Replace the panel with a single-line progress strip: `{workspaceReadiness.readyCount} of {workspaceReadiness.totalCount} setup checks complete` + a thin progress bar + a single "Finish setup" link that expands/links to the items (a `<details>` disclosure is acceptable and needs no JS). Add `.f9-setup-strip` CSS in `app/app.css` (compact, one card of vertical weight max).
- Keep the underlying `readinessGaps` data and the `.slice(0, 5)` cap; only the presentation compresses.

### B3.3 — Remove duplicate "Open watchlists" rows
The audit reports two checklist rows both linking "Open watchlists". These come from the `readinessGaps` item definitions (workspace-readiness source), not hardcoded JSX. In the readiness-gap builder (grep for the gap whose `action.label`/`href` is `/app/watchlists`), ensure at most one gap resolves to `/app/watchlists`; merge or relabel any duplicate so the strip never shows the same destination twice. If two genuinely distinct gaps both need the competitors page, give them distinct labels ("Add a competitor" vs "Confirm alert delivery") — never two identical rows.

### B3.4 — Naming (coordinate with A1)
Line 695 `<h2>Keep the Market Desk useful</h2>` is renamed by WP-A1 to `Keep your overview useful`. If A1 has landed, this is already done; if not, do it here.

**Guardrails:** no route/data changes; `WakeGreeting` stays (already rendered line 536). The `<details>` disclosure needs no new dep and must be keyboard-accessible. Do not remove the free-plan upgrade path entirely — it stays reachable via the rail and the `/app/billing` link elsewhere on the page; only the *first-run banner* drops its redundant plans CTA. Light + dark; mobile: the hero search form already stacks — verify.

**Acceptance (behavioral + visual):**
- Fresh free workspace: exactly one dominant "add your first competitor" action above the fold (the search box), plus the free-watch context banner with a single CTA — no four competing buttons.
- The setup checklist occupies ≤1 card of vertical height (compact strip), not a 5-row panel.
- No two rows/links on the Overview point to `/app/watchlists` with the same label.
- No visible "Market Desk" string.

**Tests:** `tests/dashboard.route.test.ts`, `tests/dashboard-v2.test.ts`, `tests/dashboard-activation.route.test.ts`. Update assertions for the collapsed hero/checklist. Add: fresh-free render contains exactly one primary "add competitor" CTA in the hero region; the readiness strip renders once; no duplicate `/app/watchlists` label.

---

## WP-B4 [P1] Landing rhythm + docs nav (landing whitespace, help/docs sameness)

Two parts; the docs-search part may be deferred with a note if it proves expensive.

### B4.1 — Landing mid-page rhythm (SF: "left-pinned card, 60% empty band")
`app/routes/marketing.tsx` — the mid-page sections (how-it-works, check packs, FAQ) pin a narrow card to the left third leaving a large empty horizontal band. Give each a balanced layout:
- Locate the how-it-works, check-packs, and FAQ sections (grep for the section wrappers around the FAQ data at lines ~79–163 and the `#pricing`/check-pack markup). For each, either (a) give the section a real right-column companion (e.g. the how-it-works steps get the sample-brief strip or an evidence artifact beside them), or (b) switch the section to a centered full-width layout so no section leaves a >40% empty horizontal band.
- This is CSS-layout + light JSX reflow only — do NOT change the section copy (A1/A4 own copy), the ticker, or the hero art direction (protected "poster" surface). Reuse existing `ld-*` layout classes; add balanced-grid rules in `app/app.css` scoped to the specific sections.

### B4.2 — Docs sidebar/TOC (cheap-if-possible, else defer)
`/docs` (`app/routes/docs.tsx`) currently reads near-identical to `/help` (both `PublicDocShell`). If the docs content is a list of `PublicDocBlock`s with stable titles, add a lightweight in-page TOC/sidebar: derive anchor ids from each `PublicDocBlock` title and render a sticky `<nav>` of jump links (pure CSS `position: sticky`, no JS, no search index). This makes `/docs` read as docs, distinct from `/help`.
- **Docs search is explicitly deferred** — a real search index is out of scope for a coherence pass. If even the TOC proves non-trivial (e.g. `PublicDocBlock` does not expose ids), DEFER B4.2 entirely and note it in the PR description: "docs TOC/search deferred — needs `PublicDocBlock` to emit heading ids; tracked for the part-(c) docs pass."

**Guardrails:** landing hero/ticker/type system untouched; no copy changes (owned by A1/A4); no new deps; sticky TOC must not overlap content on mobile (hide below the docs breakpoint). Light theme (public). 

**Acceptance (behavioral + visual):**
- No mid-page landing section leaves a >40% empty horizontal band at 1440px (screenshot check).
- `/docs` has a navigable TOC/sidebar distinct from `/help` — OR B4.2 is deferred with the noted reason and only B4.1 ships.

**Tests:** `tests/marketing-rebuild.test.ts`, `tests/public-doc-routes.test.ts`. Layout changes are largely visual — rely on the live screenshot check (desktop + mobile, both themes where applicable) plus `npm run build`. Add a structural test only if a stable class/anchor is introduced.

---

## VERIFICATION CHECKLIST (every package, before "done")

- `npm test` green (with the package's new/updated tests), `npm run build` green.
- Live check the touched surface in a dev server: desktop + mobile, dark + light where the surface supports both. Console-error check. No new horizontal scroll.
- Grep-confirm the retired strings are gone (per each package's acceptance).
- No route renamed, no migration added, no npm dependency added.

---

## WP SUMMARY (one line each)

- **WP-A1 — One naming spine:** "Competitors" and "Briefs" everywhere (retire "Watchlists" title, "Tracking desk", "Market Desk"; keep "Presence Desk"); align pricing/marketing/email nouns; internal identifiers untouched.
- **WP-A3 — CTA + currency coherence:** fix `/app/shares` dead-end CTA → `/app/watchlists`; document + enforce the header-action rule (remove cross-nav header actions); fix in-app billing currency by dropping `trustProxyHeaders: false` so it matches public pricing.
- **WP-A2 — Unified public nav + footer:** new shared `MarketingNav` (Search preview / Sample brief / Pricing / Help / Docs · Sign in / Open app) across landing + compare + legal/doc header; one stable wordmark tagline ("Competitor change monitoring").
- **WP-A4 — Content hygiene:** verify changelog currency; document + apply badge rule (green=state, ink-accent=recommendation); de-India examples (nykaa → neutral) in search, collections, compare links.
- **WP-B1 — Shared LockedFeature gate:** one neutral (never-red) gate component with a single upgrade CTA, replacing the three inconsistent gates (Reports / Client rooms / Team dead-end).
- **WP-B2 — Shared teaching EmptyState:** kill the duplicate left+right empty cards on Competitors + Briefs; add a "see a sample" secondary link; page-specific teaching copy in the landing voice (Shares excluded — A3 owns it).
- **WP-B3 — Overview first-run hierarchy:** one dominant add-competitor action, setup checklist → compact progress strip, remove duplicate "Open watchlists" rows, retire "Market Desk".
- **WP-B4 — Landing rhythm + docs nav:** fix the left-pinned mid-page empty bands on landing; add a docs TOC/sidebar (docs search deferred; whole item deferrable with a note).

---

## AUDIT FINDINGS I COULD NOT FULLY SPEC (with reason)

1. **Part (c) redesigns (WP-C1 `/ads/*` template, WP-C2 first-run journey, WP-C3 richer upsell teaser)** — explicitly out of scope per the task; they require the Mobbin references → 3-directions ceremony with the owner. Not specced. Note: the Mobbin MCP is currently unauthorized in this environment, so those references cannot be gathered here regardless.
2. **B3.3 duplicate "Open watchlists" rows** — the duplicate originates in the workspace-readiness gap data, not in `app.dashboard.tsx` JSX, and the readiness-gap builder was not read line-by-line here. The spec points the builder at the correct source (grep the readiness-gap definitions for two items resolving to `/app/watchlists`) but cannot quote the exact anchor line without reading `app/lib/*workspace-readiness*` on the merged tree — flagged for the builder to locate and confirm before editing.
3. **A1 email-noun alignment (item 8)** — scoped conservatively (visible "View full digest" / "in the full digest" strings only) because the digest email pipeline is heavily "digest"-named and snapshot-tested; a full noun migration through `digest-email.server.ts` types/functions is high-churn and risky. If the builder finds the customer-visible subject already avoids "digest" (it appears to), the email change may reduce to the two body strings — acceptable. Deeper email-noun churn is intentionally NOT specced.
4. **A4.1 changelog** — cannot enumerate "missing July entries" definitively from the pre-merge branch; specced as a post-merge `git log --since=2026-07-01` verification pass rather than a fixed string list, because the branch already shipped a 2026-07-20 block and the true gap (if any) is only knowable against merged `main`.
