# Noise-triage competitors research — Adversa + WhatChanged (2026-08-21)

**Item:** `c79c5e25e5` — "Adversa + WhatChanged — new noise-triage competitors
with AI impact scoring — adversa.io (from $9 lifetime …)" [scout finding]

**Outcome:** Both vendors verified live on 2026-08-21 and added to the
`/competitor-monitoring` category page as sourced promise cards
(`categoryPromises`), with the page's research-cycle dates and
`dateModified` advanced. This doc is the research receipt; the marketing
page stays price-free per its standing honesty rules, so dollar amounts
live here only.

## Adversa — https://adversa.io (live fetch 2026-08-21, HTTP 200)

- Positioning: "Monitor competitor websites. Effortlessly." — AI explains
  what changed and why it matters, "filtering out noise and surfacing
  meaningful updates".
- Noise triage claims (their own copy): groups related changes into a
  single update; filters cosmetic changes (navigation, footers, minor
  copy edits); AI explains what changed and why it matters; highlights
  shifts in messaging, pricing, or positioning.
- AI impact scoring: change detail view shows a "critical change score"
  plus an AI summary — "See exactly what changed, how significant it
  was, and why it matters without manually reviewing every diff."
- Their diagnosis of the category mirrors our complaints section:
  tools "notify you every time anything changes, even tiny cosmetic
  tweaks" and "get ignored entirely after a week".
- Pricing (founder/lifetime program, one-time): Founder Nano **$9
  lifetime** (1 competitor, 5 URLs, weekly scraping, single-page AI
  summaries; future price $1/mo), Founder Micro $59 lifetime (daily,
  aggregated AI summaries), Founder Macro $179 lifetime (3 competitors,
  twice daily, cross-competitor AI analysis). Founder badge + early
  access lane on all tiers. Founder signs as "Robin".
- Scope: general website monitoring (pricing pages, messaging, landing
  pages) — not Meta Ad Library ads. Roadmap lists integrations (Slack,
  webhooks, email, API) as "later", so today it is email notifications.

## WhatChanged — https://whatchanged.co.uk (live fetch 2026-08-21, HTTP 200)

- Positioning: "Monitor Competitors. Gain the Edge. Track every website
  change your competitors make — instantly."
- Claims (their own copy): real-time change feed with diff-style
  comparison (added text, removed content, layout shifts); new pages,
  edited content, pricing changes, navigation updates; built for SEO
  teams, content marketers, and scrappy founders.
- Early-adopter program: lifetime discounts + roadmap influence. No
  public pricing page found on the live site (2026-08-21).
- Early-stage signals, recorded honestly: the site is Lovable-generated
  (meta author "Lovable", og:title is a UUID, "Lovable Generated
  Project"), footer says © 2025, and FAQ answers render as headings
  without body copy. Treat their roadmap/claims as directional; the
  category-page card quotes only what their live page states today.
- Scope: whole-website change detection aimed at SEO — not Meta ads, no
  AI significance scoring claimed (that is Adversa's angle; the scout
  item grouped the two).

## Why this matters to Five to Nine

Both entrants validate the category page's core thesis — "alert noise is
the category's open problem" — and its wedge ("quiet is a finding"):
new competitors now win deals by promising fewer, scored, explained
alerts instead of more alerts. Five to Nine's differentiator stays the
proof layer (screenshots, page text, source links, quiet heartbeats);
neither entrant's public page claims screenshot evidence or Meta Ad
Library coverage as of 2026-08-21.

## Where this landed

- `app/routes/competitor-monitoring.tsx` — two new `categoryPromises`
  cards (dated + sourced), research-desk intro updated to "8 August 2026
  and 21 August 2026", sources-section card updated, WebPage JSON-LD
  `dateModified` → 2026-08-21.
- `tests/competitor-monitoring-category.test.ts` — contract updated and
  extended: new entrant cards must render with their check dates,
  sources, and no prices.
- Prices are intentionally absent from the marketing page (page rule:
  no hardcoded currency amounts); the $9/$59/$179 lifetime tiers are
  recorded here only.

## Verification

- `https://adversa.io/` — HTTP 200, full landing copy fetched 2026-08-21
  (pricing tiers, AI summary copy, roadmap).
- `https://whatchanged.co.uk/` — HTTP 200, full landing copy fetched
  2026-08-21 (change-feed copy, early-adopter program, Lovable meta
  signals).
- Focused tests: `npx vitest run tests/competitor-monitoring-category.test.ts`.
