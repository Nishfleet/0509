# Built-With-Intent Design Audit — 0509.io (Five to Nine)

Date: 2026-07-21
Auditor: Claude (reviewer/coordinator role)
Method: live production walk-through of https://0509.io in the owner's signed-in
Chrome session (Scout-tier workspace "Five to Nine"), desktop 1440px, screenshot
per viewport, dark + light theme spot-checks, console-error checks. Reference:
`DESIGN.md` (two systems — public "Caught in the act" bone/green/Bricolage;
workspace Vercel-calm dark) and the global anti-AI-look rules.

Owner's verdict under test: *"it does NOT feel built with intent."*

---

## Executive verdict

**Partially built with intent — and the owner's gut read is correct where it counts.**

Two clusters of pages are genuinely intentional and distinctive: the public
"poster" surfaces (landing, `/compare/*`) and the technical/status app pages
(Notifications, Source access, Developer access, Presence, Billing). These pass
the first-glance test easily — the Bricolage + signal-green + evidence/case-file
system could not belong to any other SaaS, and the search zero-result state is a
model of honest design.

But the **connective tissue fails**, and the connective tissue is what a real
first-run customer touches: the Overview, the Watchlists page, the empty states,
the plan gates, the cross-page nav. These feel assembled by different hands on
different days rather than designed as one product. Because the owner's account
is nearly empty — like every new customer's — the **first-run experience is made
almost entirely of the weakest surfaces**, so the app reads as "not built with
intent" exactly when it matters most.

### The 5 systemic reasons

1. **Nomenclature drift** — the same concept is named 3+ ways, sometimes on one
   screen. `/app/watchlists`: sidebar "Competitors", page title "Watchlists",
   card heading "Tracking desk." A half-applied "Desk" motif (Market Desk,
   Tracking desk, Presence Desk) that never reaches nav or titles. "Briefs" in
   the app vs "Digests" in pricing/route.
2. **Fragmented public navigation** — the top nav is a different set of links on
   almost every public template. A visitor on `/help` cannot reach Pricing; on
   `/terms` cannot reach Help or Docs. Four distinct navs across the public site.
3. **Duplicated, apologetic empty states** — the first-run pages render the *same*
   empty-state card twice on one screen (left column + right panel, near-identical
   copy), using a generic dotted-border card + generic gray square icon reused
   everywhere. They apologize/describe instead of teaching or showing value.
4. **Inconsistent plan-gate states** — the three Agency-gated pages (Reports,
   Client rooms, Team) use three different layouts, three copy patterns, and three
   CTA treatments — including one gate (Team) with **no upgrade button at all** and
   one (Client rooms) that renders the upsell in the system's **red error color**.
5. **Competing CTAs / no single primary action** — Overview offers four buttons for
   the one first action ("add a competitor"); the top-right secondary header button
   changes arbitrarily page to page; first-run screens are flat equal-weight card
   stacks with no "do this first."

Verdict: **the polish is real but uneven; the product lacks a shared component
layer and a single naming spine.** It looks designed in the hero and the terminal,
and assembled in the middle.

---

## Per-page scorecard

Intent score 1–10 (10 = unmistakably designed for THIS product, clear hierarchy,
teaching empty states, coherent voice).

### Public

| Route | Score | Single worst thing | Single best thing |
|---|---|---|---|
| `/` (landing) | 9 | Mid-page sections pin a narrow card to the left third, leaving a 60%+ empty horizontal band (how-it-works, check packs, FAQ) that reads unfinished | The "$159 ~~$129~~ LAST NIGHT" evidence hero + capture ticker — genuinely distinctive, lands hard |
| `/compare/meta-ad-library` | 8 | Yet another nav variant ("Create account" vs landing's "Open app") | Honest 3-column "what manual checking costs you" grid |
| `/compare/magicbrief` | 8 | Same nav fragmentation | "Bring your saved work. Gain the receipts." migration framing |
| `/help` | 7 | Wall of text, no search/cards/TOC | Green mono section eyebrows; honest support paths |
| `/docs` | 7 | Near-identical to `/help`; no docs sidebar/search/code styling | Clear proof-label explanations |
| `/changelog` | 7 | Last entry 2026-06-15 — >1 month stale despite heavy shipping since | Honest "we keep unverified work out" framing |
| `/trust` | 7 | 4th copy of the same single-article template | Genuinely honest, no unverified compliance claims |
| `/terms` | 7 | Nav collapses to just "Home / Privacy" | Plain-English, readable |
| `/privacy` | 7 | Nav collapses to "Home / Terms" | Plain-English data inventory |
| `/ads/nike.com` | **2** | Off-brand: system-bold sentence-case title (not Bricolage), generic dotted white card, apologetic empty state, vast empty page — SEO/conversion dead page | It labels honestly ("we haven't checked… recently") |
| `/auth/login`,`/auth/signup`,`/auth/forgot-password` | n/a | Redirect to `/app` when signed in — **not auditable without signing out the owner** (documented gap) | — |

### Authenticated workspace (dark default)

| Route | Score | Single worst thing | Single best thing |
|---|---|---|---|
| `/app` (Overview) | 6 | 4 competing CTAs for one action; 7-row flat checklist with no hierarchy; copy calls it "Market Desk" while title says "Overview" | Warm "GOOD MORNING / Overview" greeting + live-source status card |
| `/search` | 6.5 | Lower 60% empty with no recent/saved-search teaching; India-default example | Clean "Refine search" filter row |
| `/search` (results / 0-found) | 7.5 | "Track this competitor" appears twice | Honest zero-state: labels "Meta Ad Library visual source", offers 4 recovery actions |
| `/app/watchlists` | **4** | Triple naming (Competitors/Watchlists/Tracking desk) + TWO identical "Add your first competitor" cards + a third top-right CTA | Clean two-column bones once populated |
| `/app/presence` | 7 | "+ Add competitor" header action is off-topic here | Honest per-source "Declared sources" coverage panel |
| `/app/collections` | 6 | Right empty card just re-describes the left create form ("…with the create form") | Consistent naming; clear create form |
| `/app/digests` (Briefs) | **4** | Route/pricing say "Digests", app says "Briefs"; same empty-state card duplicated left + right | All-quiet-aware framing ("movement and all-quiet periods alike") |
| `/app/reports` | 6.5 | Text-only Agency gate, stretched full-width button, empty lower page — no feature tease | Honest "your collections/monitoring remain available" reassurance |
| `/app/shares` | 5 | Primary CTA "Open reports" is duplicated AND points to an Agency paywall the Scout user can't use; doesn't match "share a watchlist/collection" copy | Clear 90-day expiry/revoke explanation |
| `/app/clients` | 5.5 | Upsell rendered in the **red error color**; densest gate but jarring | Multi-panel structure (Active/Saved context/Archived) |
| `/app/notifications` | 7 | Header secondary action drifts again ("Open digests") | Strong status-card grid (Email Ready / Digest history / Per-watchlist alerts) |
| `/app/source-access` | 7 | Header action "Open watchlists" is unrelated | Status cards + numbered token steps + paste-and-test |
| `/app/developer-access` | 7.5 | — | Live JSON endpoint examples in mono connect to the technical voice |
| `/app/team` | **4** | THIRD gate style, **no upgrade CTA at all** — dead end | Honest one-liner |
| `/app/billing` | 7.5 | Public shows ₹ INR, in-app shows $ USD for the same browser; "Recommended" plan gets no visual emphasis | Clean Plan-active status + 3 plan cards + Monthly/Annual toggle |
| `/app/account` | 7 | "Resume setup" competes with theme controls for attention | Theme selector + honest "public pages and shared reports stay light" note |

---

## Systemic failures (patterns, with every affected route)

### SF-1 — Nomenclature drift (no single naming spine)
One concept, many names; sometimes colliding on one screen.
- **Competitors / Watchlists / Tracking desk** — `/app` (sidebar), `/app/watchlists` (title + card)
- **Briefs / Digests** — `/app/digests` (title "Briefs"), route `/digests`, pricing "Weekly/Daily Digests", landing "brief"
- **"Desk" motif half-applied** — "Market Desk" (`/app` Overview copy + landing sample-brief section), "Tracking desk" (`/app/watchlists`), "Presence Desk" (`/app/presence`) — but never in nav/titles
- Affected: `/app`, `/app/watchlists`, `/app/digests`, `/app/presence`, `/` , pricing.

### SF-2 — Fragmented public navigation
Four distinct top navs; sections are unreachable from each other.
- Landing: Search preview · Sample brief · Pricing | Sign in · Open app
- Help/Docs/Changelog/Trust: Help · Docs · Status · Start
- Compare pages: Search preview · Pricing | Sign in · Create account
- Legal: Home · Privacy (or Home · Terms)
- Also: wordmark tagline is unstable — "Competitor change monitoring" (help/docs/legal) vs "Market intelligence" (landing footer) vs "Competitor intelligence workspace" (app sidebar) vs "Saved searches and watches" (`/search` sidebar).
- Affected: every public route; app sidebar sub-label.

### SF-3 — Duplicated, apologetic, generic empty states
- Same empty-state card rendered twice per screen (left column + right panel), near-identical copy: `/app/watchlists` ("Add your first competitor" ×2), `/app/digests` ("Your first brief appears after monitoring runs" ×2).
- Generic dotted-border card + generic gray square icon reused as the empty-state chrome: `/ads/nike.com`, `/app/watchlists`, `/app/collections`, `/app/digests`, `/app/shares`.
- Empty states describe the form or apologize; none show a filled example, sample brief thumbnail, or "here's what you'll get."
- Affected: `/ads/nike.com`, `/app/watchlists`, `/app/collections`, `/app/digests`, `/app/shares`.

### SF-4 — Inconsistent plan-gate / upsell states (no shared "locked" component)
| Gate | Eyebrow | Headline color | CTA |
|---|---|---|---|
| `/app/reports` | green "REPORTS" | neutral | full-width "View Agency plan" |
| `/app/clients` | green "AGENCY FEATURE" | **red/error** | normal "Review Agency plans" |
| `/app/team` | none | neutral | **none — dead end** |
Three copy patterns too: "included in the Agency plan" / "are an Agency feature" / "come with Agency." Red is the system's diff-deletion/error semantic — misused here as premium-feature emphasis, so a paid feature reads like a broken one.
- Affected: `/app/reports`, `/app/clients`, `/app/team`.

### SF-5 — Competing CTAs & arbitrary header actions (no single primary per screen)
- `/app` Overview: `+ Add competitor` (top-right) + "Add competitors" (card) + "Search ads" (input) + "Search competitor" (checklist) — four routes to one action.
- `/app/watchlists`: three "Add competitor" targets.
- `/app/shares`: "Open reports" twice, pointing at a paywall.
- Top-right secondary header button changes arbitrarily: Notifications / Open reports / Open digests / Open watchlists / API docs / none — no rule.
- First-run screens are flat equal-weight stacks (Overview's 7-row checklist, two of whose rows both say "Open watchlists").
- Affected: `/app`, `/app/watchlists`, `/app/shares`, most app pages.

### SF-6 — Global-first convention violated in surface details
- Currency mismatch for the same browser: landing pricing in **₹ INR** (₹999 / ₹4,999 / ₹15,000) vs in-app billing in **$ USD** ($11 / $53 / $158).
- India-centric examples/defaults: `/search` placeholder `nykaa.com` + Country default "India"; `/app/collections` example "Nykaa competitors".
- Affected: `/`, `/app/billing`, `/search`, `/app/collections`.

### SF-7 — Minor coherence debris
- `/changelog` last entry 2026-06-15 (stale >1 month).
- Badge accent semantics flip: landing greens the "Recommended" plan; `/app/billing` greens "Current plan" and grays "Recommended" (which then gets no emphasis at all).
- Affected: `/changelog`, `/`, `/app/billing`.

### What IS built with intent (protect these)
- Landing hero + capture ticker; both `/compare/*` pages.
- `/search` zero-result state (honest, source-labeled, recovery actions).
- Status-card app pages: Notifications, Source access, Developer access, Presence.
- Theme system: dark AND light both render cleanly, no contrast failures on the pages checked (Overview, Billing).
- No console errors on `/app`.

---

## THE OVERHAUL PLAN

Ranked work packages. Each: anchor · change · acceptance criteria.

### (a) Quick coherence fixes (1 PR series, no new design work)

**WP-A1 — One naming spine.** *Anchor:* SF-1.
Change: pick one canonical name per concept and enforce it in nav, page title,
card heading, route-facing copy. Recommendation: "Competitors" (drop "Watchlists"
title + "Tracking desk"), "Briefs" everywhere (align pricing "Digests" → "Briefs",
keep `/digests` route or add `/briefs` alias), retire "Market Desk"/"Desk" motif or
apply it deliberately as the product's name for the whole workspace — not half.
*Accept:* no screen shows two names for one concept; grep of user-facing strings
has a single term per concept; pricing and app agree on Briefs/Digests.

**WP-A2 — Unified public nav + footer.** *Anchor:* SF-2.
Change: one shared header/footer component across all public routes (landing,
help, docs, changelog, trust, terms, privacy, compare). One link set; every public
section reachable from every other. Stabilize the wordmark tagline to one string.
*Accept:* identical nav markup on all public routes; from any public page a user
can reach Pricing, Help, Docs, and legal in ≤2 clicks.

**WP-A3 — Fix the broken/mismatched CTAs.** *Anchor:* SF-4/SF-5/SF-6.
Change: (1) `/app/team` gets an upgrade CTA. (2) `/app/shares` empty CTA points to
a real share action (or "Create your first watchlist"), not the Agency paywall.
(3) De-duplicate "Open reports"/"Track this competitor"/"Add competitor" repeats to
one primary + optional secondary per screen. (4) Resolve the ₹/$ public-vs-app
currency mismatch (single geo source of truth).
*Accept:* every gated page has exactly one working upgrade CTA; no screen repeats
the same CTA label; landing and billing show the same currency for one browser.

**WP-A4 — Content hygiene.** *Anchor:* SF-7.
Change: refresh `/changelog` through 2026-07; align plan-badge accent semantics
(green = the recommended plan, consistently landing + billing); de-India the
default examples per global-first (geo-driven placeholder, neutral sample brand).
*Accept:* changelog current; one badge-color rule documented in DESIGN.md and used
both places; no hardcoded India example strings.

### (b) Per-page intent redesigns (component-level, within existing system)

**WP-B1 — Shared "locked feature" component.** *Anchor:* SF-4.
Change: one gate component (eyebrow + headline + one-line value + single upgrade
CTA + optional blurred feature preview). Roll to Reports, Client rooms, Team.
Remove red; red stays diff-deletion only.
*Accept:* the three gates are visually identical but for copy/preview; no red;
each shows a glimpse of the paid feature.

**WP-B2 — Shared teaching empty-state component.** *Anchor:* SF-3.
Change: one empty-state (illustrative or sample-data preview + one clear action +
"here's what you'll get" line). Replace the dotted generic card + gray square icon.
Eliminate the duplicate left+right rendering — one empty state per screen.
Roll to Watchlists, Collections, Briefs, Shares.
*Accept:* no screen shows the empty state twice; each teaches with an example or
sample output; dotted-card/gray-square chrome removed.

**WP-B3 — Overview hierarchy pass.** *Anchor:* SF-5.
Change: one hero action ("Add your first competitor" → paste box), demote the
7-row checklist into a compact progress strip, standardize the top-right header
action rule (one consistent secondary action or none).
*Accept:* one dominant CTA above the fold; checklist ≤1 card of vertical weight;
header secondary action follows a documented rule across all app pages.

**WP-B4 — Landing rhythm fix + docs/help polish.** *Anchor:* landing whitespace,
help/docs sameness. Change: give the left-pinned mid-page sections (how-it-works,
check packs, FAQ) real right-column content or full-width layouts; add a docs
sidebar/TOC + search so `/docs` reads as docs, not a second `/help`.
*Accept:* no mid-page section leaves a >40% empty horizontal band; docs has
navigable structure distinct from help.

### (c) Ground-up redesigns — REQUIRE the Mobbin references workflow with the owner present
Per standing design policy (references → 3 directions rendered in Chrome → pick →
build brief). **Do not design these solo.**

**WP-C1 — `/ads/*` programmatic-SEO template (highest priority).** *Anchor:* SF-3,
`/ads/nike.com` score 2. It is off-brand, empty, apologetic, and is a public
SEO/conversion landing surface. Needs its own on-brand template: brand context,
what Five to Nine would show, a real preview/teaser, and a conversion path — in the
"Caught in the act" system. This is the single worst page in the product.

**WP-C2 — The first-run / empty workspace experience** (Overview + Watchlists +
Briefs + the empty-state system as one designed flow). This is the actual first
thing every paying customer sees; today it's the weakest cluster. Design the
"day zero → first competitor → first brief" arc as one intentional journey, not
per-page empty cards.

**WP-C3 (optional) — Plan-gate / upsell moment as a designed surface** if WP-B1's
component work reveals the upsells deserve a richer teaser treatment (blurred
report preview, sample client room) rather than a text card.

---

## Notes / gaps
- Auth pages (`/auth/login`, `/auth/signup`, `/auth/forgot-password`) redirect to
  `/app` while signed in and were **not** audited live; they presumably use the
  public "Caught in the act" system. Re-audit from a logged-out session before the
  redesign ships (whole-funnel rule).
- Mobbin MCP was unavailable this session (needs authorization) — WP-C references
  must be gathered when it's connected, with the owner.
- No product code was modified. The only state change was toggling workspace theme
  to Light for a coherence check and restoring it to System.
