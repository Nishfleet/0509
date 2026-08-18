# Five to Nine — Manual SaaSHub Listing (prepared 2026-08-11)

**Item:** Prepare a manual SaaSHub listing for Five to Nine
[scout 2026-08-09, risk: green] [traction] [unreviewed-by-grok]

**Status:** PREPARED, NOT SUBMITTED. This document contains every field the
SaaSHub product submission needs, grounded in the official SaaSHub submission
guidelines (`https://www.saashub.com/services/submit`, checked 2026-08-11) and
the repo's canonical product copy. The base listing is **free**; submission
requires a SaaSHub account, an inbox on the `0509.io` domain for ownership
verification, and owner approval of a few personal fields plus tagline and
description — see [Owner decisions](#owner-decisions). The optional paid
`$99/month` featured listing is a separate decision and is NOT required.

## Submission status (recorded 2026-08-11)

**NEEDS_NISH_STEP — not submitted.** Recorded 2026-08-11:

- **Mailbox prerequisite cleared.** A live Gmail → Agentic Inbox delivery
  test to `support@0509.io` succeeded on 2026-08-11, so the SaaSHub
  ownership-verification requirement (an inbox on the `0509.io` domain) is
  satisfied.
- **Form open, nothing submitted.** The SaaSHub submission page is open in
  Nish's logged-in Mac browser with `https://0509.io` filled in. The next
  **Continue** button explicitly accepts the SaaSHub Terms and Privacy —
  do not call it submitted. Exact next step: **Nish confirms the venue
  terms, then the browser run can continue** and finish the form with the
  fields below.
- **Re-verified 2026-08-12.** Freshness pass before this lane closed the
  scout item: submission URL, all five category pages, the Ad Spy
  substitute, every listed competitor slug, and the India startup page
  re-checked (HTTP 200); plan facts (Free 1 watchlist + weekly brief; Scout
  3 watchlists/6-hour checks; Starter 10/3-hour + daily briefs; Agency 75)
  re-checked against `app/lib/plan-entitlements.ts`. One fix landed:
  `PrimeSpy.net`'s SaaSHub page is `https://www.saashub.com/primespy-net`.
  Everything else remains ready to paste; only the owner decisions below
  still stand between this document and the submission.
- **Re-verified 2026-08-14.** Freshness pass from the 2026-08-14 lane run
  (evidence record: `.lane/reports/0509-lane1-saashub-listing-already-prepared.md`):
  submission URL, all five category pages, the Ad Spy substitute, every
  listed competitor slug (including `primespy-net` and `MagicBrief`), the
  India startup page, and the product pages (`0509.io/`, `/search`,
  `/auth/signup`, `/compare/magicbrief`) re-checked live — 31/31 HTTP 200,
  no slug drift. Plan facts re-checked against `app/lib/plan-entitlements.ts`
  and the live homepage copy in `app/routes/marketing.tsx` (lines 32, 78,
  102, 140, 297–300); no corrections needed. Nothing submitted — the same
  owner decisions below still stand.

## Eligibility check against SaaSHub submission guidelines

Verified against `https://www.saashub.com/services/submit` (2026-08-11). Five
to Nine passes every guideline:

| SaaSHub guideline | Five to Nine posture |
|---|---|
| SaaS, IaaS & PaaS products and services are accepted | Yes — SaaS competitor-monitoring product, not an agency, blog, or store. |
| **Products that are not released yet will be rejected immediately** | Live in public early access since 2026-06-15 with working email magic-link signup at `https://0509.io/auth/signup`; public search preview works without an account. Not a waiting list. |
| Landing pages with an email form for a waiting list are rejected | Full product site: features, proof brief, pricing, FAQ, docs, and a working signup flow. |
| Products using free subdomains are rejected (e.g. `my-app.vercel.com`) | Own custom domain — `https://0509.io` is the submission URL. Never use `0509.in` (legacy redirect-only). |
| Products must be in English | Yes. |
| Software development agencies are rejected | Not an agency. |

Note on launch age: unlike BetaList, SaaSHub has **no recency requirement** —
its only hard reject conditions are "not released yet" and "waiting-list
landing page", neither of which applies. The 2026-06-15 public early-access
launch (~8 weeks ago) is therefore **not a fit risk** on SaaSHub, and there is
no reason to wait.

## Ready-to-paste form fields

Fields below map to the SaaSHub product submission
(`https://www.saashub.com/services/submit`, free SaaSHub account required).
After approval, the product page lives at `https://www.saashub.com/five-to-nine`.

### Product name

`Five to Nine`

### Website URL

`https://0509.io`

### Tagline (one line — shown under the product name in lists)

Recommended (descriptive style that fits SaaSHub lists; e.g. RivalSweep's
tagline is "Competitor page monitoring, with the evidence attached."):

> Competitor ad and landing-page monitoring with screenshot evidence.

Alternates:

> Know when competitors change the offer — with proof.

> See when competitors change their Meta ads and landing pages, with proof.

### Description

Recommended (primary paste, ~100 words — same canonical copy as the BetaList
preparation, so every directory listing stays consistent):

> Five to Nine watches your competitors' Meta ads and landing pages, then
> sends screenshot evidence and change alerts before your next meeting. Paste
> a competitor site to preview their current ads — no account needed. On paid
> plans, Five to Nine checks competitors every 3–6 hours, compares each check
> against a baseline, and saves source-linked proof for every confirmed
> change: screenshots, page text, and links you can open yourself. Quiet
> periods still send a heartbeat, so silence always means we looked and
> nothing moved. Growth teams use it to catch offer, pricing, and
> landing-page changes the day they happen.

Extended version (if the form allows more room, ~135 words):

> Five to Nine watches your competitors' Meta ads and landing pages, then
> sends screenshot evidence and change alerts before your next meeting. Paste
> a competitor site to preview the ads they're running — no account needed,
> with coverage and freshness labeled honestly. Sign up to set up monitoring:
> checks every 3–6 hours on paid plans, a first scan that records a baseline,
> and one alert per confirmed change. Every capture keeps its source link so
> you can open the same public page yourself. If nothing moved, you get a
> quiet heartbeat instead of silence. Growth teams use Five to Nine to catch
> offer changes, new hooks, pricing moves, and landing-page shifts as they
> happen, then brief the counter-move. Free plan includes a weekly brief for
> one competitor; paid plans add more competitors, faster checks, daily
> briefs, instant alerts, and evidence collections with clear monthly caps.

Both versions stay inside the repo's honest-claims rules: proof-first, no
unlimited monitoring, no channel claims we cannot make.

### Categories

All verified live on SaaSHub 2026-08-11 (HTTP 200 on the category pages);
re-verified 2026-08-12:

1. `Competitor Monitoring` — `https://www.saashub.com/best-competitor-monitoring-software` — **primary** (exact-fit category; 15 products listed, including Visualping, Crayon, Klue, Kompyte)
2. `Competitive Intelligence` — `https://www.saashub.com/best-competitive-intelligence-software`
3. `Advertising` — `https://www.saashub.com/best-advertising-software`
4. `Website Monitoring` — `https://www.saashub.com/best-website-monitoring-software`
5. `Competitor Research` — `https://www.saashub.com/best-competitor-research-software`

`Ad Spy` (`https://www.saashub.com/best-ad-spy-software`) is an acceptable
substitute if the form limits choices or the advertising angle should be
stronger. The submission form explicitly advises: "List a few relevant
categories. You may check your competitors' categories for inspiration."

### Competitors

The submission form warns: "The submission will be slowed down and put to the
bottom of the queue if there are not listed competitors." List generously.
All names below were verified to have live SaaSHub pages on 2026-08-11
(re-verified 2026-08-12; one slug corrected — `PrimeSpy.net` lives at
`https://www.saashub.com/primespy-net`, not `primespy.net`):

Direct category peers:

- `Visualping` (webpage change monitoring)
- `Distill.io` (page monitoring)
- `Wachete` (web page change tracking)
- `Kompyte` (competitor tracking)
- `Crayon` (market and competitive intelligence)
- `Klue` (competitive intelligence for sales)
- `RivalSweep` (competitor page monitoring with evidence — closest positioning)
- `ChampSignal` (competitor monitoring)
- `MyIntelBrief` (competitor monitoring briefs)
- `Watch My Competitor` (market analytics)

Ad-intelligence peers (Meta/creative focus):

- `BigSpy` (Meta/TikTok ad spy)
- `SocialPeta` (ad intelligence platform)
- `Adligator` (AI ad spy for competitor creatives)
- `PrimeSpy.net` — `https://www.saashub.com/primespy-net` (Meta Ad Library
  research)
- `Pipiads` (TikTok ad spy)
- `SOCIALFUEL` (Meta/Google/TikTok ad intelligence)
- `LandingSpy` (ad landing-page spy)
- `SEMRush` (all-in-one marketing toolkit with competitive analysis)

(If `MagicBrief` is still listed at submission time, include it — Five to Nine
has a live migration guide at `https://0509.io/compare/magicbrief` for teams
coming from MagicBrief's wind-down, and SaaSHub lists it as a direct
competitor for that audience.)

### Pricing

`Freemium` — short value:

> Free plan: watch 1 competitor with a weekly email brief. Paid plans: Scout
> (3 competitors, 6-hour checks), Starter (10 competitors, 3-hour checks,
> daily briefs), Agency (75 competitors). Localized prices shown at checkout.

Do not hardcode a currency amount in the pricing field — live pricing display
is Dodo-backed and buyer-localized by policy (`MEMORY.md` pricing rule). The
form also accepts a link to official pricing if a price string is not
required.

### Location / Startup Details

- Country: India (product is India-first; SaaSHub's Startups directory has a
  country page for India with 4,048 startups — `https://www.saashub.com/startups/india`).
- Founder name and HQ city: **OWNER TO CONFIRM** (SaaSHub's Startup Hub says
  founders add their startup "by submitting it on SaaSHub and filling in the
  'Startup Details' section").

### Screenshots / images

- Logo: `brand/five-to-nine-colored-logo.svg` (already in repo; matches the
  BetaList preparation).
- SaaSHub product pages display a "Landing page" screenshot — capture before
  submitting (see [Asset checklist](#asset-checklist)).

### Features & Specs (product-page section)

SaaSHub fills "Features & Specs" on product pages automatically, and these
lists are frequently wrong (RivalSweep's own page, as of 2026-08-11, shows
sweepstakes/giveaway features on a competitor-monitoring product). After
approval, correct the list via the page's Edit flow using the honest bullets
below, drawn from SaaSHub's own feature vocabulary (verified on the
Competitor Monitoring category page, 2026-08-11):

1. `Email Alerts` — change alerts and digests delivered by email.
2. `Competitive Analysis` — competitor ad and landing-page monitoring.
3. `Competitor Tracking` — watchlists with baseline + change evidence.
4. `Data Export` — client reports and CSV/API exports on paid plans.
5. `Customizable Reports` — agency briefs with shared report branding.

Do NOT select `Real-time Monitoring` — checks run every 3–6 hours, and the
honest-claims rules forbid implying faster cadence.

## Honesty guardrails (do not claim in the listing)

Sourced from `MEMORY.md`, `README.md`, `docs/launch-readiness.md`, and the
live homepage copy in `app/routes/marketing.tsx`:

- **No Slack or WhatsApp delivery claims** — both channels are dormant and
  not part of the public offer.
- **No unlimited monitoring claims** — evidence checks are metered with clear
  monthly caps; no `Real-time Monitoring` feature tag.
- **No automated non-Meta ingestion claims** — do not claim automated
  TikTok/Google/YouTube/LinkedIn/Pinterest ingestion or automated
  spend/reach/impression benchmarks.
- **No compliance claims** — no SOC 2 / HIPAA / GDPR / zero-retention
  guarantees.
- **Public data only** — every capture is from the public Meta Ad Library and
  public landing pages; nothing behind a login.
- **Coverage and freshness are labeled and can vary by source** — Meta ads
  tracking graduated from beta 2026-08-12, gated on a green production canary.
- **Use `0509.io` everywhere** — `0509.in` is legacy redirect-only and must
  not appear in listing copy, links, or images.

## Ownership verification (SaaSHub-specific, recommended)

The submission form says: "Verifying your product will give it a higher
priority. You will need an email address on the product's domain." Five to
Nine has one already: `support@0509.io` (`app/lib/support.ts`). Verification
also unlocks the product management page, the free "Submit" tool that posts
to 107 other directories, Startup Details, EU listing eligibility, and the
Featured Listing page. Owner confirms which inbox receives the verification
code.

## Submission process (verified from SaaSHub pages, 2026-08-11)

1. Register a free account at `https://www.saashub.com/register`.
2. Submit at `https://www.saashub.com/services/submit` with the website URL
   (`https://0509.io`), the categories and competitors listed above.
3. All submissions go through an approval process. Products that are not
   released yet are rejected immediately — Five to Nine's live status and
   listed competitors both de-risk the queue position.
4. After approval the product page is live at
   `https://www.saashub.com/five-to-nine`; SaaSHub auto-generates
   "alternatives" pages that surface Five to Nine on its competitors' pages.
5. Verify ownership from the management page using an `0509.io` inbox
   (priority boost + management tools).
6. Fill the "Startup Details" section (India) so Five to Nine appears in
   SaaSHub's Startups directory, which feeds their country pages.
7. Optional paid promotion — Featured Listing at `$99/month` ("Feature My
   Product"): listed on competitors' pages, category pages, homepage, and the
   weekly newsletter; estimated 10–18 targeted referrals/month, live in
   minutes, no review queue, cancel in one click. This is a **separate owner
   decision**, not required for the base listing.
8. Measure traffic: SaaSHub appends its own tracking parameters to outbound
   product links — filter analytics for source `saashub` / `utm_source=saashub`.
9. SaaSHub pages are community-editable: anyone can propose edits, and the
   auto-generated Features & Specs are often wrong (see RivalSweep). Watch
   the page after listing and fix inaccuracies via the Edit flow.
10. Optional: embed the SaaSHub "approved" badge on the marketing site after
    verification for a free backlink from `saashub.com`.

## Asset checklist

- [ ] Logo uploaded from `brand/five-to-nine-colored-logo.svg`.
- [ ] Screenshot: homepage hero (`https://0509.io/`) — this becomes the
      "Landing page" screenshot on the product page.
- [ ] Screenshot: public search preview with an example query
      (`https://0509.io/search`), which needs no account.
- [ ] Screenshot: proof brief / digest from an internal account, showing
      baseline + change evidence (account needed).
- [ ] Verify every screenshot shows no personal/private data (mask emails and
      any non-public workspace content).

## Owner decisions

1. Tagline and description version to paste (recommended values above).
2. Verification inbox — must be an address on the `0509.io` domain
   (`support@0509.io` exists in `app/lib/support.ts`; confirm it is watched).
3. Founder name, HQ city, and Startup Details fields (India).
4. Whether to also buy the Featured Listing (`$99/month`, cancel anytime) —
   only after the free listing is approved and traffic is measurable.
5. Approve and capture the asset checklist screenshots.

After the owner confirms these, the manual submission itself is a ~10-minute
form fill at `https://www.saashub.com/services/submit` — every field value is
in this document.
