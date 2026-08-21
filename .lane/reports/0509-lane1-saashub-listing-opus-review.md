# Lane 1 report — SaaSHub listing for Five to Nine, fresh opus review pass (2026-08-15)

**Item:** Prepare a manual SaaSHub listing for Five to Nine
[scout 2026-08-09, risk: green] [traction] [unreviewed-by-opus]

**Status:** VERIFIED_CURRENT — the manual SaaSHub listing is fully prepared on
origin/main (`docs/saashub-listing-2026-08-11.md`, PRs #607/#667). This lane
is the opus review pass the item's `[unreviewed-by-opus]` tag calls for: a
fresh critical review of every load-bearing claim in the prep against the
live sites and the repo's current source of truth. Every checked fact is
current; no corrections were needed. Submission remains an owner step.

## Verdict

The listing prep is complete, accurate, and ready to paste. Nothing in this
review changed the prep: all 27 SaaSHub URLs (submission page, 5 category
pages, Ad Spy substitute, India startup page, 18 competitor slugs +
MagicBrief) return HTTP 200 with real product pages (no soft-404s); every
guideline quote in the prep matches the live submit page verbatim; every plan
fact in the listing copy matches `app/lib/plan-entitlements.ts` exactly; and
the listing copy mirrors the live homepage rendered in production.

The one thing no lane can do is click **Continue** on the SaaSHub submission
form: it accepts SaaSHub's Terms of Service and Privacy Policy, and requires
Nish's logged-in SaaSHub account plus his choices on the doc's five owner
decisions. That owner step is unchanged and is the only remaining action.

## What the review checked (2026-08-15, live)

### SaaSHub surface — 27/27 URLs live, real pages

| Check | Result |
|---|---|
| `https://www.saashub.com/services/submit` | 200; rendered page shows the exact guidelines the prep quotes ("List a few relevant categories…", "slowed down and put to the bottom of the queue if there are not listed competitors", "Verifying your product will give it a higher priority… email address on the product's domain") and the full reject list (dev agencies, waiting-list landing pages, unreleased products, free subdomains, non-English) |
| Category pages ×5 + Ad Spy substitute | All 200 (Competitor Monitoring, Competitive Intelligence, Advertising, Website Monitoring, Competitor Research, Ad Spy) |
| `https://www.saashub.com/startups/india` | 200 |
| Competitor slugs ×18 + MagicBrief | All 200, real product titles (spot-checked `primespy-net` → "PrimeSpy.net reviews", `rivalsweep` → "RivalSweep reviews", `magicbrief` → "MagicBrief reviews", `visualping`, `distill-io`); no slug drift, no soft-404s |

The prep's competitor list (10 category peers + 8 ad-intelligence peers +
MagicBrief) is fully live. The doc's corrected `primespy-net` slug still
holds.

### Product surface — live and matching the listing copy

- `https://0509.io/` — rendered in a browser: hero copy matches the listing
  tagline options; "checks every 3–6 hours on paid plans"; quiet heartbeat
  ("All quiet — 24 ads checked"); Free/Scout/Starter/Agency card shapes
  (1/3/10/75 watchlists, 6h/3h/3h+6h cadences, weekly/daily+weekly briefs);
  "Localized at checkout" on every price card; `support@0509.io` in the
  footer and MagicBrief migration paragraph; no hardcoded currency, no
  `.in` domain, no beta wording.
- `https://0509.io/search`, `/auth/signup`, `/compare/magicbrief` — all 200.
- The prep's ownership-verification mailbox `support@0509.io` is the live
  support address (`app/lib/support.ts:13`).

### Repo source-of-truth cross-checks

- Plan facts in the listing's Pricing field and description (Free 1
  competitor + weekly brief; Scout 3 competitors / 6-hour checks; Starter 10
  competitors / 3-hour checks + daily briefs; Agency 75 competitors) match
  `app/lib/plan-entitlements.ts` exactly: `free.watchlists=1` +
  `digestCadence=weekly` + `scheduledScanCadence=weekly`;
  `scout.watchlists=3` + `every_6h`; `starter.watchlists=10` + `every_3h` +
  `daily_and_weekly`; `agency.watchlists=75`.
- Listing copy claims ("screenshot evidence and change alerts before your
  next meeting", "checks every 3–6 hours", quiet heartbeat, no unlimited
  monitoring) match `app/routes/marketing.tsx` verbatim (lines 32, 78, 102,
  140, 863).
- Same canonical plan facts are used by the BetaList prep
  (`docs/betalist-listing-2026-08-10.md`), so directory listings stay
  consistent.
- `docs/saashub-listing.md` correctly points to
  `docs/saashub-listing-2026-08-11.md` as canonical/superseded.
- Honesty guardrails (no Slack/WhatsApp delivery claims, no unlimited
  monitoring, no hardcoded currency, `0509.io` only, no `.in`) all still
  hold against the live site and the repo.

## Findings

None — no corrections, no slug drift, no plan or copy drift since the
2026-08-12 pass (PR #667) and the 2026-08-14 evidence pass on branch
`lane1/saashub-listing-already-prepared` (unmerged; its report is
`.lane/reports/0509-lane1-saashub-listing-already-prepared.md` on that
branch).

## Recommendation

1. **Owner step (Nish):** on the SaaSHub submission page
   (`https://www.saashub.com/services/submit`), confirm the Terms and
   Privacy, then finish the form with `docs/saashub-listing-2026-08-11.md`
   (fields are paste-ready: categories, 18+ competitors, tagline, description,
   freemium pricing value, India startup details). Verify ownership with
   `support@0509.io` for the queue-priority boost.
2. **No new product code or doc edits are needed** from this lane; the prep
   is current. When the owner completes submission, close the item and (per
   the older `docs/saashub-listing.md` follow-up gate) run the grok review
   pass over the submitted listing.
3. Optional follow-up for the fleet: merge or close the stale unmerged branch
   `lane1/saashub-listing-already-prepared` (its evidence pass is superseded
   by this report on main).

## Files

- `.lane/reports/0509-lane1-saashub-listing-opus-review.md` — this evidence
  record; unique to this lane. No shared report files touched; no product
  code touched.

## Proof

- Live fetches (2026-08-15): 27/27 SaaSHub URLs HTTP 200; 5/5 0509.io URLs
  HTTP 200; spot-checked product titles on `primespy-net`, `rivalsweep`,
  `magicbrief`, `visualping`, `distill-io` — real product pages.
- Browser render (camoufox): 0509.io homepage (hero, plan cards, pricing
  localization, support address, MagicBrief link) and
  saashub.com/services/submit (guidelines text + Terms/Privacy Continue
  button) captured live.
- Repo: `app/lib/plan-entitlements.ts` lines 121–179; `app/routes/marketing.tsx`
  lines 32/78/102/140/863; `app/lib/support.ts:13`.
