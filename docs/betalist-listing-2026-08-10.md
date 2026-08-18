# Five to Nine — Manual BetaList Listing (prepared 2026-08-10)

**Item:** Prepare a manual BetaList listing for Five to Nine
[scout 2026-08-09, risk: green] [traction] [unreviewed-by-grok]

**Status:** PREPARED, NOT SUBMITTED (re-verified 2026-08-12). This document contains every field the
BetaList submission form needs, grounded in official BetaList guidance and the
repo's canonical product copy. Submission requires a paid BetaList plan and an
owner decision on a few personal fields (founder name, location, contact
email) plus launch-status wording — see [Owner decisions](#owner-decisions).

## Submission status (recorded 2026-08-11, re-verified 2026-08-12)

**SKIPPED_PAID — not submitted.** Recorded 2026-08-11 and re-verified
2026-08-12:

- BetaList's official Support/FAQ page states that **all submissions are
  paid** and there is **no free submission option** — re-checked live at
  `https://betalist.com/faq` on 2026-08-12, unchanged. With no free tier,
  this venue is skipped rather than pursued; the prepared copy below stays
  on file if the paid tier ever becomes a separate owner decision (see
  [Launch-status wording](#launch-status-wording-owner-decision) and
  [Owner decisions](#owner-decisions)).
- If the paid tier is ever approved: submission plans differ only by
  featuring speed and newsletter-guarantee, and a startup that is not
  selected is refunded in full automatically (5–10 business days). The
  downside of trying is the fee plus review time, not lost money on a
  rejected listing.

## Eligibility check against BetaList submission guidelines

Verified against `https://betalist.com/criteria` (2026-08-10). Five to Nine
passes every guideline:

| BetaList guideline | Five to Nine posture |
|---|---|
| Product should be relatively new (pre-launch / private beta / recently launched) | Live since 2026-06-15 in public early access (~8.5 weeks as of 2026-08-12). See [Launch-status wording](#launch-status-wording) before submitting — the older the launch, the weaker the fit. |
| Not featured on BetaList before | Correct — no prior listing. Each startup gets one pre-launch and one launch feature. |
| Needs to be a technology startup | Yes — SaaS competitor-monitoring product, not a blog/newsletter/store. |
| Distinct, decent-looking landing page | Yes — custom-designed `https://0509.io` marketing site (no template), with product info, proof brief, FAQ, and pricing. |
| Visitors should be able to sign up or get access | Yes — live email magic-link signup at `https://0509.io/auth/signup`; public search preview works without an account. |
| Own domain (no free-hosting subdomain, no app-store link) | Yes — `https://0509.io` is the submission URL. Never use `0509.in` (legacy redirect-only). |

## Ready-to-paste form fields

Fields below map to the BetaList submission form (`https://betalist.com/submit`,
requires a free BetaList account; all submissions are paid plans — see
[Submission process](#submission-process)).

### Product name

`Five to Nine`

### URL

`https://0509.io`

### Tagline (one line — shown as the subtitle under the product name)

Recommended (matches the SEO title already live on the homepage):

> Know when competitors change the offer — with proof.

Alternates:

> See when competitors change their ads and landing pages, with proof.

> Competitor ad and landing-page monitoring with screenshot evidence.

### Description

Recommended (primary paste, ~100 words):

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

### Topics / categories

Recommended (up to 5; all verified to exist on BetaList 2026-08-10):

1. `Competitive Intelligence` (`/browse/data-analytics/competitive-intelligence`) — primary
2. `Advertising` (`/browse/marketing/advertising`)
3. `Tracking` (`/browse/data-analytics/tracking`)
4. `Marketing Analytic` (`/browse/data-analytics/marketing-analytic`)
5. `Brand Monitoring` (`/browse/marketing/brand-monitoring`)

(SaaS under Productivity is an acceptable substitute if the form limits
choices.)

### Pricing

`Freemium` — short value:

> Free plan: watch 1 competitor with a weekly email brief. Paid plans: Scout
> (3 competitors, 6-hour checks), Starter (10 competitors, 3-hour checks,
> daily briefs), Agency (75 competitors). Localized prices shown at checkout.

Do not hardcode a currency amount — live pricing display is Dodo-backed and
buyer-localized by policy (`MEMORY.md` pricing rule).

### Launch status

Recommended: `Recently launched — public early access`.

See [Launch-status wording](#launch-status-wording) for the tradeoff.

### Founder / location

- Founder name: **OWNER TO CONFIRM**
- Location: India (product is India-first; owner to confirm the city/country
  shown)
- Contact email: **OWNER TO CONFIRM** (BetaList never publishes the email on
  the listing; it is used for account and decision notifications)

### Screenshots / images

- Logo: use `brand/five-to-nine-colored-logo.svg` (already in repo).
- Cover/screenshot set — capture before submitting (see
  [Asset checklist](#asset-checklist)).

## Honesty guardrails (do not claim in the listing)

Sourced from `MEMORY.md`, `README.md`, `docs/launch-readiness.md`, and the
live homepage copy in `app/routes/marketing.tsx`:

- **No Slack or WhatsApp delivery claims** — both channels are dormant and
  not part of the public offer.
- **No unlimited monitoring claims** — evidence checks are metered with clear
  monthly caps.
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

## Asset checklist

- [ ] Logo uploaded from `brand/five-to-nine-colored-logo.svg`.
- [ ] Screenshot: homepage hero (`https://0509.io/`).
- [ ] Screenshot: public search preview with an example query
      (`https://0509.io/search`), which needs no account.
- [ ] Screenshot: proof brief / morning-brief preview section on the
      homepage, or a real digest from an existing account.
- [ ] Screenshot: watchlist surface showing baseline + change evidence
      (account needed; use an internal account).
- [ ] Verify every screenshot shows no personal/private data (mask emails and
      any non-public workspace content).

## Submission process (verified from BetaList FAQ, 2026-08-10; re-verified 2026-08-12)

1. Create a free BetaList account (`https://betalist.com/sign_up`).
2. Go to `https://betalist.com/submit` and complete the form with the fields
   above.
3. Choose a submission plan — **all submissions are paid**; plans differ by
   how quickly the startup is featured and whether newsletter inclusion is
   guaranteed. If the startup is not selected, the payment is refunded in
   full automatically (5–10 business days).
4. Editorial review happens before featuring; decision arrives by email.
   Status is tracked from the BetaList dashboard.
5. If featured: the "Visit Site" button is a do-follow backlink routed
   through a 301 with `ref=betalist` attribution, and BetaList adds UTM
   parameters to outbound links — filter analytics for source `betalist` to
   measure traffic.
6. Expect contact from directory scrapers after featuring; BetaList never
   shares contact information itself (FAQ note) — this is normal scraping
   noise, not a leak.

## Re-verification log (2026-08-12)

Refresh done by lane 2 on 2026-08-12 before reporting this item complete.
Every claim in this document was re-checked against live sources:

| Check | Evidence | Verdict |
|---|---|---|
| Submission guidelines unchanged | Live fetch of `https://betalist.com/criteria` on 2026-08-12 | Five to Nine still passes all six guidelines; "recently launched" is still the best available fit bracket |
| Paid-only requirement unchanged | Live fetch of `https://betalist.com/faq` on 2026-08-12: "All submissions are paid. There is no free submission option." | SKIPPED_PAID decision stands as of today |
| Plan/entitlement copy still accurate | `docs/plan-catalog.md` + `app/lib/plan-entitlements.ts`: Free 1 watchlist/weekly digest, Scout 3 @ 6-hour checks, Starter 10 @ 3-hour + daily digests, Agency 75 | The Pricing value and both description versions match the catalog exactly |
| Meta ads tracking status current | Graduation commit `ac393f02` (PR #638) merged on main 2026-08-12: Meta ads tracking no longer beta, gated by green production canary | Guardrail line in this document updated by that commit; rollback = restore the beta caveat if the canary turns red |
| Launch age | Production domains live since 2026-06-15 (`README.md` production note) | ~8.5 weeks as of 2026-08-12 — still inside "recently launched" but trending toward the weaker fit (see Launch-status wording) |
| Tagline matches live site | Homepage SEO title + hero in `app/routes/marketing.tsx`: "Know when competitors change the offer." | Recommended tagline is identical to the live page copy |
| No stale beta wording | `grep -i "beta\|early access" app/routes/marketing.tsx app/routes/compare.magicbrief.tsx` returns nothing | No customer-facing beta caveat remains to conflict with the listing; eligibility row updated to drop the stale "beta caveat" phrase |
| Logo asset exists | `brand/five-to-nine-colored-logo.svg` in repo | Asset checklist item 1 is ready to upload |

## Launch-status wording (owner decision)

BetaList's guideline favors products that are pre-launch, private-beta, or
**recently launched**; "launched weeks ago or longer" is listed as less
suitable. Five to Nine has been live in public early access since 2026-06-15
(~8.5 weeks as of 2026-08-12). Options:

- **A — Submit now as "recently launched / early access."** Highest-fit
  framing available today; risk that the editorial team still sees an older
  launch. Recommended if the goal is the traction channel now.
- **B — Hold for a genuine pre-launch slot.** Only possible if a new
  invitation-only phase is created (e.g., a restricted feature set behind
  invite). Not currently true of the product.
- **C — Skip.** If the launch is considered complete, BetaList's audience fit
  drops and the paid fee + refund mechanics are not worth the noise.

Recommended: **A**, paired with honest "early access" phrasing in the
description so the listing and the live site never disagree (no beta wording —
the site's Meta ads tracking graduated from beta 2026-08-12, so the listing
must not claim the product is in beta).

## Owner decisions

1. Founder name, location, and contact email (required by the form).
2. Launch-status wording (option A/B/C above).
3. Submission plan tier (budget + speed + newsletter guarantee tradeoff).
4. Approve the tagline and description version to paste.
5. Capture and attach the asset checklist screenshots.

After the owner confirms these, the manual submission itself is a ~10-minute
form fill at `https://betalist.com/submit` — every field value is in this
document.
