# Five to Nine — Manual Segwise Listing Pitch (prepared 2026-08-21)

**Item:** Get Five to Nine listed on Segwise's July 2026 "Best Ad Spy and
Competitor Tracking Tools" comparison — current-month on-call listing item
[lane 2, 2026-08-21] [traction]

**Status:** NEEDS-NISH — prepared and ready to send; the send step itself
remains and requires the owner. **NEEDS-NISH: send the pitch via LinkedIn to
Angad Singh (recommended), or email from `support@0509.io` once the owner
confirms a Segwise vendor-facing inbox.** (No repo-local outbound mail path
exists to fire the message — same constraint the ad-stack.ai lane recorded.)
This document contains a complete pitch for inclusion in
Segwise's "Best Ad Spy and Competitor Tracking Tools in 2026" roundup
(`https://segwise.ai/blog/best-ad-spy-competitor-tools`), grounded in the
live article (fetched 2026-08-21, HTML + the Superblog `.md` source), the
venue's own site, and the repo's canonical product copy.

## What the venue actually is (verified 2026-08-21)

Segwise (`https://segwise.ai`) is an AI creative-analytics and ad-generation
platform (GrowthDuty Inc.) that publishes a large owned-content blog with
**100 roundups in its "Tools & Comparisons" category alone** — all by the
same growth team (primarily Angad Singh, "Marketing and Growth"). The
target article is one of those roundups:

- **"Best Ad Spy and Competitor Tracking Tools in 2026: Top 7 Compared"** —
  `https://segwise.ai/blog/best-ad-spy-competitor-tools`, published
  **2026-07-13**, banner note **"_Updated July 2026_"**, ~17 min read,
  category "Tools & Comparisons", tags `creative intelligence tools`,
  `Paid Social`. Author: Angad Singh.
- **Seven tools ranked:** 1. Segwise (the venue's own product), 2. Meta Ad
  Library, 3. AdSpy, 4. BigSpy, 5. PowerAdSpy, 6. SocialPeta, 7. Sensor
  Tower (Pathmatics). Six of seven are third-party tools — the roundup
  already routinely includes direct competitors, so an honest, well-argued
  addition is consistent with its editorial pattern.
- **The article's taxonomy (its own words):** ad spy tools split into two
  layers — *"ad libraries and spy databases"* that "collect competitor ads
  and let you search, filter, and save them" (output: *a feed of
  creatives*), and *"competitor creative intelligence"* that "reads those
  ads with AI, tags their elements" (output: *a decision*). It also says
  the category "overlaps heavily with what people call competitor ad
  **tracking** tools" and links its own
  [competitor-ad-tracking guide](https://segwise.ai/blog/competitor-ad-tracking-guide).
- **The script is updated periodically** ("Updated July 2026" under the
  hero, ~6 weeks after its 2026-07-13 publish date), so a pitch now targets
  the **next update cycle** of this exact article — not a retroactive edit.

## Submission path (verified 2026-08-21)

**There is no public submission form, no "submit a tool" page, and no
sponsored-slot language anywhere in the article or the blog.** This is not
a directory with a submission flow (unlike SaaSHub/AlternativeTo/BetaList);
it is a vendor content program, so the path is a direct pitch to the
editorial owner:

- **Recommended route — the article's author:** Angad Singh is the author
  of this exact roundup and the main writer of the blog (profile at
  `https://segwise.ai/blog/author/angad-singh`, LinkedIn
  `https://www.linkedin.com/in/-angadsingh/`). A LinkedIn message or a
  connection request with the pitch below reaches the person who owns the
  script. This route is verified to exist (live author page + live LinkedIn
  profile link from it); it requires no account we do not already have.
- **Secondary route — the venue's public contact:** the only mailbox
  published anywhere on the site is `privacy@segwise.ai`
  (privacy-policy-only, encoded in the Privacy Policy page — decoded
  2026-08-21), which is not an editorial inbox and must not carry a pitch.
  The site's other contact surfaces are lead-gen CTAs (demo booking via
  `cal.com/segwise-bb/segwise-demo`, "Start Free Trial") — usable as a last
  resort ("include tool suggestions for your ad-spy roundup" in the message)
  but not the primary route.
- **No pay-to-play offer exists or is appropriate:** nothing on the page
  mentions paid placements, and the repo's budget policy has no
  listing-purchase line. The pitch below offers a free product seat only.
- **No coverage guarantee, by design:** inclusion is the author's editorial
  call. This is a submission into the next update cycle, not a confirmed
  placement; do not record it as "listed" until the article changes or the
  author replies.

## Fit check against the article's taxonomy

The roundup's shelf logic makes a genuine room for Five to Nine — a
**third layer neither shelf currently covers**:

| Roundup shelf | Tools there | Five to Nine fit |
|---|---|---|
| Ad libraries / spy databases (raw feed of creatives) | Meta Ad Library, AdSpy, BigSpy, PowerAdSpy, SocialPeta, Sensor Tower (Pathmatics) | **Partial** — Five to Nine surfaces Meta ads from the same public Ad Library data, but it makes no raw-coverage-volume claim (AdSpy ~200M ads, BigSpy 1B+, SocialPeta 13B+). Do not pitch it as a database. |
| Competitor creative intelligence (AI analysis → decision) | Segwise (AI tagging + gap analysis) | **No** — Five to Nine does not tag creatives with AI or run gap/white-space analysis. Do not pitch it as an intelligence layer. |
| **What changed since your last check (monitoring → alert → proof)** | **Nobody — the gap** | **Yes** — this is the exact catalog position: baseline scan, scheduled re-checks (3–6h paid), one alert per confirmed change, source-linked screenshot proof, quiet-hearted silence. |

The roundup's own words open the door: Meta Ad Library's stated weakness is
"no historical data … no analysis … for systematic tracking across many
competitors, **it does not scale**" — which is precisely the problem
Five to Nine solves. The article's definition of the category explicitly
includes competitor **tracking** tools. So the pitch frames Five to Nine as
the honest "tracking layer" between the raw feed and the analysis layer:
*see the ads (libraries) → know what changed with proof (Five to Nine) →
decide what to test (Segwise)*. This complements the venue's own product
rather than competing with it, and Segwise's own competitor-tracking
feature page (`https://segwise.ai/features/competitor-tracking`) shows the
product line already believes monitoring is part of the category.

Honest edges to state up front (match the repo's claim rules): Meta ads +
public landing pages only, no spend estimates, no non-Meta automated
ingestion, checks are scheduled not real-time.

## Submission status (recorded 2026-08-21)

**NEEDS-NISH — ready to send; the send step is the only remaining action.**

**NEEDS-NISH: send the pitch via LinkedIn to Angad Singh (recommended), or
email from `support@0509.io` once the owner confirms a Segwise
vendor-facing inbox.**

- **No venue form, account, or payment required** — the whole submission is
  one pitch message (LinkedIn DM recommended; see
  [Exact next step](#exact-next-step-owner-decision)).
- **No repo-local outbound mail path exists** to fire an email from this
  worktree: the only outbound sender in the product is the production
  Worker's Cloudflare `send_email` binding (`EMAIL_FROM_EMAIL:
  alerts@0509.io`, used for digests/alerts), which requires production
  secrets/deploy and is not appropriate for a one-off vendor pitch. The
  pitch therefore waits on the sender — same constraint the ad-stack.ai
  lane recorded on 2026-08-11 (`docs/adstack-listing-2026-08-11.md`).
- **No coverage guarantee, by design** — inclusion is the author's editorial
  call; this is a submission into the next update cycle, not a confirmed
  placement.

### Re-verified 2026-08-23 — still not listed; send remains blocked on owner decision (NEEDS-NISH)

Fresh pass recorded 2026-08-23 (evidence:
`.lane/reports/0509-lane1-segwise-listing-reverify-20260823.md`):

- Roundup `https://segwise.ai/blog/best-ad-spy-competitor-tools` returned
  HTTP 200 and still does NOT contain Five to Nine or any `0509.io` link;
  Angad Singh is still the listed author. **Status stays NEEDS-NISH — ready
  to send.**
- Venue URLs still HTTP 200: the article, author page
  (`https://segwise.ai/blog/author/angad-singh`), blog
  (`https://segwise.ai/blog`), Privacy Policy
  (`https://segwise.ai/privacy-policy`).
- Product URLs still HTTP 200: `https://0509.io`, `https://0509.io/search`,
  `https://0509.io/auth/signup`, `https://0509.io/compare/magicbrief`.
- Pitch facts still match current repo copy: "screenshot evidence and
  change alerts" (hero, `app/routes/marketing.tsx`) and the every-3–6-hours
  cadence lines in the same file; `SUPPORT_EMAIL = "support@0509.io"` at
  `app/lib/support.ts:13`.
- Nothing changed since 2026-08-21 that affects the pitch. The sole
  remaining action is unchanged: the owner sends the prepared message via
  LinkedIn to Angad Singh (recommended) or a verified Segwise
  vendor-facing inbox once one is confirmed. Success signal stays an
  article change or an author reply — never a claim of listing.

## Ready-to-send pitch (the whole submission is one message)

Recommended delivery: LinkedIn message to Angad Singh (article author,
`https://www.linkedin.com/in/-angadsingh/`), or email if the owner has a
verified Segwise vendor-facing inbox. Subject/Messages line:

Subject: `Tool for your ad-spy roundup: Five to Nine (competitor ad monitoring with proof)`

> Hi Angad,
>
> Tool suggestion for your "Best Ad Spy and Competitor Tracking Tools in
> 2026" roundup: **Five to Nine** (https://0509.io) — competitor ad and
> landing-page monitoring where every change alert carries screenshot
> evidence and a source link you can open yourself.
>
> Your roundup splits ad spy tools into libraries/databases (raw ads) and
> creative intelligence (AI reads the ads). Five to Nine is the tracking
> layer between them: it scans competitors' Meta ads and public landing
> pages on a schedule, compares against a baseline, and sends one alert per
> confirmed change — plus a quiet heartbeat when nothing moved, so silence
> always means we looked. That's the "it does not scale" gap you note in
> your Meta Ad Library write-up: paste a competitor site at
> https://0509.io/search and see the ads they're running now, no account.
>
> How it fits your table: monitoring + change alerts + source-linked
> screenshot proof, Meta-only for ads plus public landing pages. We're
> honest about the edges — we're not a 200M-ad database and we don't do AI
> gap analysis or spend estimates; we tell you what changed and when, with
> proof.
>
> Happy to give you a seat (free plan or a paid one, your pick — free plan
> covers one competitor with a weekly email brief) if you'd like to test
> the claim before the next update of the roundup.
>
> Best,
> Five to Nine

### Why this copy (mapped to the venue's actual article)

- **Uses the roundup's own taxonomy** ("libraries/databases" vs "creative
  intelligence", the "tracking layer" gap) instead of generic self-praise.
- **Quotes their own stated weakness of Meta Ad Library** ("it does not
  scale" for systematic tracking) as the honest entry point — their words,
  not an attack.
- **States edges up front** (no raw-coverage-volume claim, no AI tag/gap
  analysis, no spend estimates) — matches the repo's honesty guardrails and
  the venue's own roundup voice (it reports honest limitations for every
  tool on the list).
- **Offers a free seat**, never payment — nothing on the page sells
  placement, and the repo has no listing-purchase line.

## Honesty guardrails (do not claim in the pitch)

Same rules as the SaaSHub/BetaList/AlternativeTo/ad-stack preparations,
sourced from `MEMORY.md`, `README.md`, and the live homepage copy
(`app/routes/marketing.tsx`):

- **No Slack or WhatsApp delivery claims** — both channels are dormant and
  not part of the public offer.
- **No unlimited monitoring claims** — evidence checks are metered with
  clear monthly caps; no real-time-monitoring framing (checks run every
  3–6 h on paid plans).
- **No automated non-Meta ingestion claims** — do not claim automated
  TikTok/Google/YouTube/LinkedIn/Pinterest ingestion or automated
  spend/reach/impression benchmarks.
- **No compliance claims** — no SOC 2 / HIPAA / GDPR / zero-retention
  guarantees.
- **Public data only** — every capture is from the public Meta Ad Library
  and public landing pages; nothing behind a login.
- **Coverage and freshness are labeled and can vary by source** — Meta ads
  tracking graduated from beta 2026-08-12, gated on a green production
  canary.
- **Use `0509.io` everywhere** — `0509.in` is legacy redirect-only and must
  not appear in the pitch, links, or any follow-up.
- **No AI-tool framing** — OCR/translation is internal plumbing; the pitch
  positions Five to Nine as monitoring, not an "AI tool", even though the
  venue itself is an AI company.

## Live URLs referenced (re-verified 2026-08-21, all HTTP 200)

- `https://0509.io` — product home (canonical tagline in
  `app/routes/marketing.tsx`: "Know when competitors change the offer.").
- `https://0509.io/search` — public no-account search preview (the URL the
  pitch points at).
- `https://0509.io/auth/signup` — working email magic-link signup.
- `https://0509.io/compare/magicbrief` — MagicBrief migration guide.
- Venue: `https://segwise.ai/blog/best-ad-spy-competitor-tools` (article,
  HTTP 200, 2026-08-21), author page
  `https://segwise.ai/blog/author/angad-singh` (200), blog
  `https://segwise.ai/blog` (200), competitor-tracking feature page
  `https://segwise.ai/features/competitor-tracking` (linked from article),
  Privacy Policy `https://segwise.ai/privacy-policy` (200; source of the
  only published mailbox, `privacy@segwise.ai`).

## Submission process (verified from the live article + site, 2026-08-21)

1. Send the pitch to the article's author (recommended: LinkedIn at
   `https://www.linkedin.com/in/-angadsingh/`; or a verified Segwise
   vendor inbox if the owner confirms one). No venue form, account, or
   payment exists for this.
2. The author owns the script and runs an ongoing update cadence
   ("Updated July 2026" ~6 weeks after the 2026-07-13 publish). A reply or
   an article change is the only confirmation signal.
3. If the author wants to test the claim, grant a free seat (free plan:
   1 competitor + weekly email brief; paid seats are the owner's call).
4. Never pay for placement — nothing on the venue suggests it is for sale.

## Exact next step (owner decision)

1. **Send the pitch** via LinkedIn to Angad Singh (recommended), or via
   email from `support@0509.io` (the live verified `0509.io` mailbox) if
   the owner first confirms a Segwise vendor-facing inbox (common patterns
   like `hello@segwise.ai` / `support@segwise.ai` are unverified and must be
   checked before use).
2. After sending, record the send date + any reply under
   [Submission status](#submission-status-recorded-2026-08-21) so the fleet
   knows this venue is no longer pending.
3. If no reply within ~2 weeks, follow up once (LinkedIn or the venue
   contact form) — then leave it; the roundup updates on the author's
   cadence, and hunting further is not an approved use of budget.
4. Track success as an article change at the roundup URL (a new entry, a
   mention in the FAQ, or an update to the comparison table); filter
   analytics for referer host `segwise.ai` for attributable traffic.

## Files

- `docs/segwise-listing-2026-08-21.md` — this prepared-listing package.
- `.lane/reports/lane2-segwise-listing-prepared.md` — lane evidence record.

## Rollback

N/A — documentation-only; no product code, data, or billing change. The
pitch is not sent by anything in this repo.