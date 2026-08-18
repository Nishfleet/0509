# Five to Nine — Manual AlternativeTo Listing (prepared 2026-08-11)

**Item:** Prepare a manual AlternativeTo listing for Five to Nine
[research-desk 2026-08-08, risk: green] [traction]

**Status:** PREPARED, NOT SUBMITTED. This document contains every field the
AlternativeTo "Suggest new application" form needs, grounded in the official
AlternativeTo FAQ and live listing pages (all verified 2026-08-11), and the
repo's canonical product copy. AlternativeTo is free to submit to; the only
cost option is an optional one-time $5 priority review fee. Submission
requires a free AlternativeTo account with a verified email, plus owner
decisions on a few fields — see [Owner decisions](#owner-decisions).

## Submission status (recorded 2026-08-11)

**NEEDS_NISH_STEP — not submitted.** Recorded 2026-08-11:

- **Free submission is available**, but it requires a **new or existing
  AlternativeTo account plus email verification**. The optional one-time
  $5 priority review is **skipped** — the free backlog queue is accepted.
- Exact next step: **Nish signs in (or creates and verifies) the
  AlternativeTo account**, then the prepared suggestion can be submitted
  with the fields below.

## How AlternativeTo listing works (verified from official FAQ, 2026-08-11)

AlternativeTo is a free, crowd-sourced software directory. Anyone can add
software; listings are human-reviewed before going public:

- Add via user menu (top-right user icon) → **"Suggest new application"**.
  The email address must be verified first (anti-spam requirement).
- The form collects: name, official website URL, platforms, license,
  descriptions, tags, and attachments (icon, screenshots). There is no paid
  submission tier — listings are free.
- New apps sit in a review backlog for **at least a few months** by default.
  An optional **one-time $5 "priority review"** moves an app to the front of
  the queue (usually reviewed within 1–2 business days, up to a week over
  holidays). Paying moves you up the queue only — it does not buy approval,
  the approval criteria are identical, and the fee is non-refundable once the
  review is done (fully refundable until then). The "Get reviewed sooner"
  button is also available later from **My submissions**.
- Submission status is tracked in **My submissions** (user menu). Pending
  submissions are visible only to the submitter; after approval they appear
  publicly; declined apps disappear and the submitter is notified.
- After approval, anyone can edit the page via **"Contribute to this page" →
  Edit / Update Information**, and suggest the app as an alternative to other
  apps via **"Contribute to this page" → Suggest Alternatives**. Name and
  official-website edits always require admin verification.

## Eligibility check against AlternativeTo rules

Checked against the official FAQ (`https://alternativeto.net/faq/`,
2026-08-11) and the live directory:

| AlternativeTo rule | Five to Nine posture |
|---|---|
| App must be English-language | Yes — product and listing copy are English. |
| Released or easily accessible ("open beta" OK; closed beta / announced-only not accepted) | Live in public early access since 2026-06-15 with open signup — qualifies. |
| Not on the decline list (basic AI tools, AI wrappers for LLMs, converters, calculators, personal websites, custom-made services, small auto-built websites, etc.) | Five to Nine is a purpose-built SaaS with its own landing page, signup, and monitoring product. Do NOT describe it as an "AI tool" — AI (OCR/translation) is internal plumbing, not the product (see [Honesty guardrails](#honesty-guardrails)). |
| Genuine software product, not a profile-advertisement | Listed via "Suggest new application" only; never via the user profile (profiles used to advertise are blocked as spam). |
| Geo policy: "usually do not accept apps and services only available or targeted specifically at single nations" | **Main eligibility risk.** Five to Nine is India-first by go-to-market but is live and signup-open globally at `https://0509.io` (Cloudflare global edge, English UI, buyer-localized pricing). Listing copy must position it as globally available with an India-first focus, never "India-only". See [Approval risks](#approval-risks). |
| Category saturation: "may deny apps indistinguishable from what's already widely available, low-quality/low-effort, and over-saturated categories" | Competitor monitoring is a busy category on AlternativeTo (Kompyte alone lists 26 alternatives). Mitigation: complete, high-quality listing (verified tags, real features, good screenshots, honest distinct positioning: proof-first change alerts on public Meta Ad Library data with a no-account search preview). See [Approval risks](#approval-risks). |
| One entry per product (no separate free/pro entries) | Single "Five to Nine" entry; plan tiers are described in the description, not as separate apps. |
| Name not colliding with an existing entry | Verified 2026-08-11: `https://alternativeto.net/software/five-to-nine/` is a 404 — name is free, no disambiguation suffix needed. |
| No porn / no hardware / not a game | Not applicable — SaaS web app. |

## Ready-to-paste form fields

Fields below map to the "Suggest new application" form (requires a free
AlternativeTo account with a verified email; reached from the top-right user
icon).

### Name

`Five to Nine`

### Official website URL

`https://0509.io`

Clean URL only — AlternativeTo policy forbids UTM tags on the official link;
traffic is tracked via the `Referer` header (`alternativeto.net`) instead
(see [Traffic & attribution](#traffic--attribution)). Never use `0509.in`
(legacy redirect-only).

### Platforms

1. `Online` (Web)
2. `Software as a Service (SaaS)`

(Both values verified in use on live competitor pages 2026-08-11. Do not add
Self-Hosted — that platform is for installable web apps.)

### License

`Free with limited functionality` (Freemium) — not open source
(Proprietary). Verified policy: a free version that performs the app's main
purpose qualifies as Freemium; Five to Nine's free plan (1 competitor,
weekly email brief) meets this.

### Origin

`India`

### Supported languages

`English`

### Pricing (free-text field; no hardcoded currency per repo policy)

> Free plan with limited functionality: watch 1 competitor with a weekly
> email brief. Paid subscription plans (Scout, Starter, Agency) add more
> competitors, faster checks, daily briefs, instant alerts, and evidence
> collections with clear monthly caps. Localized prices are shown at
> checkout.

(MEMORY.md pricing rule: live pricing display is Dodo-backed and
buyer-localized — never paste a fixed currency amount into the listing.)

### Short description (one line — shown under the name on the page)

Recommended (matches the live homepage hook):

> Proof-backed monitoring for competitors' Meta ads and landing pages, with
> screenshot evidence and change alerts before your next meeting.

Alternates:

> Know when competitors change the offer — with proof.

> Competitor ad and landing-page monitoring with screenshot evidence.

### Full description ("What is ...?" section — plain text, NO links, emails, or phone numbers allowed per FAQ)

Recommended (paste-ready, ~150 words; no URLs anywhere):

> Five to Nine watches your competitors' Meta ads and landing pages, then
> sends screenshot evidence and change alerts before your next meeting. Paste
> a competitor site to preview the ads they are running right now — no
> account needed, with coverage and freshness labeled honestly. Sign up to
> set up monitoring: checks every 3–6 hours on paid plans, a first scan that
> records a baseline, and one alert per confirmed change. Every capture keeps
> its source link so you can open the same public page yourself. If nothing
> moved, you get a quiet heartbeat instead of silence — so silence always
> means we looked and nothing changed. Growth teams use Five to Nine to catch
> offer changes, new hooks, pricing moves, and landing-page shifts as they
> happen, then brief the counter-move. The free plan includes a weekly brief
> for one competitor; paid plans add more competitors, faster checks, daily
> briefs, instant alerts, and evidence collections with clear monthly caps.

Both versions stay inside the repo's honest-claims rules: proof-first, no
unlimited monitoring, no channel claims we cannot make, no AI-tool framing.

### Tags

All verified to resolve to live pages on AlternativeTo (2026-08-11). Tags and
features auto-convert, so a tag can surface as a feature filter.

1. `competitive-intelligence` (verified tag page, heavily populated — primary)
2. `market-intelligence` (seen on Dozier.io)
3. `market-research` (seen on Dozier.io)
4. `brand-monitoring` (seen on Dozier.io)
5. `product-marketing` (seen on Compint)
6. `marketing` (seen on Compint)
7. `competitors-research` (seen on Compint)
8. `competitor-price-monitoring` (seen on Compint)

### Features to suggest (voted on by users; use verified vocabulary)

1. `Competitor Monitoring` (verified feature page — `competitor-monitoring`)
2. `Competitive Analysis` (seen on Compint)
3. `Price Monitoring` (seen on Compint)

(Do not add "AI-Powered" or "Privacy focused" properties — keep the listing
grounded in monitoring proof, not AI framing.)

### Expected category

AlternativeTo assigns the breadcrumb category (admin-side); based on live
peers, expect **Online Services** (Compint's category) or **Business &
Commerce** (Dozier.io's category). No submitter action needed.

### Icon

- Use `brand/five-to-nine-colored-logo.svg` as the source.
- AlternativeTo spec: **squared PNG or SVG, 280x280 or bigger, transparent
  background**. The repo asset is a 920x220 wide lockup (colored 59 mark +
  dark wordmark), so export a squared icon variant (e.g., the 59 mark on a
  transparent square canvas) at 280x280+ before submitting.

### Screenshots

See [Asset checklist](#asset-checklist).

## Suggest Five to Nine as an alternative (post-approval)

Once the listing is approved, the biggest discoverability lever is being
suggested as an alternative on existing, related app pages — this is the
flow that puts Five to Nine in front of people already searching for
competitor/ad monitoring tools. Flow per FAQ: open the target app page →
**"Contribute to this page" → Suggest Alternatives** → search for the
existing app → "Suggest as alternative and select among its alternatives".
Approved suggestions make Five to Nine appear on that app's alternatives
list.

Recommended targets (targets 1–8 verified to exist and be listed
2026-08-11; target 0 is conditional — see note), by fit with
AlternativeTo's own rule — same main task and focus:

0. **MagicBrief** (`/software/magicbrief/`) — wind-down buyers land here
   first (MagicBrief closed 2026-07-31; displaced users browse its
   alternatives page when picking a replacement). **Time-sensitive:**
   suggest Five to Nine as an alternative on this page BEFORE the wind-down
   attention fades. AlternativeTo blocked automated verification
   (HTTP 403 to a plain fetch on 2026-08-12), so confirm the page is still
   listed at submission time — if it is gone (or was never listed), skip
   and keep target 1 below. Our live migration guide
   (`https://0509.io/compare/magicbrief`) is the landing page for that
   audience.
1. **Facebook Ad Library** (`/software/facebook-ad-library/`) — the manual
   ad-transparency tool Five to Nine automates on top of; 15 alternatives
   listed today. Highest-fit target.
2. **Kompyte** (`/software/kompyte/`) — "track & analyze competitors in
   real-time"; 26 alternatives listed.
3. **Crayon.co** (`/software/crayon-co/`) — competitive intelligence
   platform; 17 alternatives listed.
4. **SpyFu** (`/software/spyfu/`) — competitor ad research; 12 alternatives
   listed.
5. **Dozier.io** (`/software/dozier-io/`) — competitive-intelligence tool
   for small businesses and agencies; 3 alternatives listed (easy to rank).
6. **Perch Intel** (`/software/perch-intel/`) — automated website change
   detection and monitoring.
7. **Compint** (`/software/compint/`) — proof-based competitive
   intelligence; closest positioning analogue, 13 alternatives listed.
8. **Owler** (`/software/owler/`) — competitive intelligence platform;
   21 alternatives listed.

Also visible in the `competitive-intelligence` tag page (all live):
AdBeat, AdClarity, Anstrex, Adison.io, Contify, Argus Intel, RivalSense,
Accordably, Competitive Business, Changedetection.io. Suggesting on 3–5
pages (not all at once) keeps the activity organic-looking and within
AlternativeTo's anti-spam norms.

## Honesty guardrails (do not claim in the listing)

Sourced from `MEMORY.md`, `README.md`, `docs/launch-readiness.md`, the live
homepage copy in `app/routes/marketing.tsx`, and AlternativeTo FAQ rules:

- **No links, emails, phone numbers, or addresses in the description** —
  FAQ rule; the URL fields (Official Website, Creator Website) carry links.
- **No UTM tags on the official website link** — FAQ rule; track via
  referer instead.
- **No Slack or WhatsApp delivery claims** — both channels are dormant and
  not part of the public offer.
- **No unlimited monitoring claims** — evidence checks are metered with
  clear monthly caps.
- **No automated non-Meta ingestion claims** — do not claim automated
  TikTok/Google/YouTube/LinkedIn/Pinterest ingestion or automated
  spend/reach/impression benchmarks.
- **No compliance claims** — no SOC 2 / HIPAA / GDPR / zero-retention
  guarantees.
- **Public data only** — every capture is from the public Meta Ad Library
  and public landing pages; nothing behind a login.
- **Coverage and freshness are labeled and can vary by source** — Meta ads
  tracking graduated from beta 2026-08-12, gated on a green production canary.
- **No AI-tool framing** — OCR/translation is internal plumbing; describing
  the product as an "AI tool" or "AI wrapper" risks the decline list.
- **No "India-only" framing** — geo policy risk; position as globally
  available (0509.io), India-first focus.
- **Use `0509.io` everywhere** — `0509.in` is legacy redirect-only and must
  not appear in listing copy, links, or images.
- **No incentivized upvotes, no fake accounts** — AlternativeTo's rank
  algorithm drops or removes apps caught doing this; sharing the listing
  organically is fine.

## Approval risks (honest read)

1. **Geo framing.** AlternativeTo "usually" declines apps targeted only at
   single nations. Five to Nine is India-first but globally available; the
   description must make global availability and open signup obvious.
2. **Category saturation.** Competitor monitoring is well populated. A thin
   or low-effort listing risks decline; the mitigation is completing every
   field well (description, tags, features, icon, screenshots) and leading
   with what is genuinely distinct: no-account search preview, screenshot
   evidence on every alert, heartbeat-on-quiet, public-source-only data.
3. **Backlog wait.** Without the $5 priority review, approval can take
   months — the listing still costs nothing to submit now.

## Asset checklist

- [ ] Export squared icon (280x280+ PNG or SVG, transparent background)
      from `brand/five-to-nine-colored-logo.svg` (mark-only or lockup on a
      square canvas).
- [ ] Screenshot: homepage hero (`https://0509.io/`).
- [ ] Screenshot: public search preview with an example query
      (`https://0509.io/search`), which needs no account.
- [ ] Screenshot: proof brief / morning-brief preview section on the
      homepage, or a real digest from an existing account.
- [ ] Screenshot: watchlist surface showing baseline + change evidence
      (account needed; use an internal account).
- [ ] Verify every screenshot shows no personal/private data (mask emails
      and any non-public workspace content).

## Submission process (verified from AlternativeTo FAQ, 2026-08-11)

1. Create a free account at `https://alternativeto.net/signup` and verify
   the email address (required before submitting apps).
2. User icon (top right) → **"Suggest new application"** → fill in the
   fields above (name, official URL, platforms, license, descriptions, tags,
   icon, screenshots) → **"Submit the application"**.
3. Decide on the optional one-time **$5 priority review** (either offered
   after submitting, or later via **My submissions** → "Get reviewed
   sooner"). It moves the app to the front of the review queue (1–2 business
   days, up to a week over holidays) but does not change approval criteria;
   refundable in full until the review happens, non-refundable after.
4. Track status in **My submissions** — pending apps are visible only to
   the submitter; that is normal.
5. If approved, the page goes public. Then, via **"Contribute to this
   page"**: suggest Five to Nine as an alternative on the target pages in
   [Suggest Five to Nine as an alternative](#suggest-five-to-nine-as-an-alternative-post-approval),
   and vote/comment on the page to seed activity. Edits to the name or
   official URL always need admin verification.
6. If declined, the app leaves My submissions and the submitter is
   notified; approval is at admins' discretion, and paying does not change
   the criteria.

## Traffic & attribution

- AlternativeTo does not allow UTM parameters on the official website link;
  they recommend reading the **HTTP `Referer` header** instead. Filter
  analytics for referer host `alternativeto.net` to measure listing traffic.
- After approval, organic likes/comments on the page help rank; share the
  page link socially, but never incentivize upvotes or create fake accounts
  (rank algorithm drops or removes such apps).

## Owner decisions

1. Account email to register on AlternativeTo (must be verifiable; any
   email works).
2. Pay the one-time $5 priority review, or let the free backlog take its
   months-long course?
3. Approve the short + full description versions, tags, and features to
   paste.
4. Approve the "suggest as alternative" target list (3–5 recommended).
5. Capture and attach the asset checklist screenshots + squared icon.
6. Confirm analytics referer filter for `alternativeto.net` exists.

After the owner confirms these, the manual submission itself is a ~15-minute
form fill — every field value is in this document.
