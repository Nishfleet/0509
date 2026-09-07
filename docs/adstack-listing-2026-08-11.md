# Five to Nine — Manual ad-stack.ai Listing (prepared 2026-08-11)

**Item:** Get Five to Nine listed on ad-stack.ai's "best ad intelligence
software in 2026" ranking — the current-month on-call listing item
[scout, risk: green] [traction]

**Status:** NEEDS-NISH — prepared and ready to send; the single send step
remains and requires the owner. **NEEDS-NISH: send the prepared email below
from `support@0509.io` to `hello@ad-stack.ai`.** (No repo-local outbound mail
path exists to fire the email — the only sender is the production Worker's
`send_email` binding, unsuitable for a one-off vendor email — so this is a
human owner action.) This document
contains the complete submission for the ad-stack.ai journal
(`https://ad-stack.ai`), grounded in the venue's own submission guidance
(About page + FAQ, fetched 2026-08-11) and the repo's canonical product copy.

## What the venue actually is (verified 2026-08-11)

ad-stack.ai is **not a directory with a submission form** — it is an
independent performance-marketing journal ("ad·stack: The performance
marketing journal", colophon: "Reviews & Field Notes"). Its ranking article is
an editorial essay:

- **"The best ad intelligence software in 2026, ranked"** —
  `https://ad-stack.ai/blog/best-ad-intelligence-software-2026/`,
  published **2026-07-15**. Eight tools ranked: 1. Superscale, 2. Foreplay,
  3. Meta Ad Library, 4. Atria, 5. Sensor Tower (Pathmatics), 6. AdSpy,
  7. BigSpy, 8. SpyFu.
- The ranking weighs three questions — "what are competitors running, what's
  been running long enough to be profitable, and what should we do about it" —
  and states it weights toward the third (intelligence → output).
- **Submission path (venue's own words, About page + FAQ):** "Got a tool we
  should look at? … Send us a note at hello@ad-stack.ai with a short
  description and a public link. We can't promise coverage of every
  submission, but we read every one. Being suggested has no bearing on the
  eventual verdict." (FAQ Q-04: "Can I send in a tool to be reviewed? Yes —
  send a note via the contact link in the footer.")
- **No pay-to-play:** "We don't take sponsored reviews. We don't run
  pay-to-play comparisons." (About page). "No vendor pays for placement, and
  no review is sponsored." (FAQ Q-01). They pay for their own tool seats at
  the public plan tier.
- **Cadence:** "Every quarter. … the score on the main review only moves at
  the next full re-test." (FAQ Q-03). The published 2026-07-15 essay cannot
  be edited retroactively; the realistic target is the **next quarterly
  re-test of this essay (~October 2026)**, and the way to be in that re-test
  is the email below, now.

## Fit check against the venue's editorial lens

The ranking's own taxonomy (from the essay):

| Ranking shelf | Tools there | Five to Nine fit |
|---|---|---|
| Intelligence → output (top slot) | Superscale | **No** — Five to Nine does not generate ads; it monitors. Do not pitch it as an ad generator. |
| Monitoring specialists / research-first | Foreplay, Meta Ad Library, Atria, AdSpy, BigSpy, SpyFu | **Yes** — competitor ad + landing-page monitoring with change alerts is the exact shelf. |
| Spend/impression estimates | Sensor Tower (Pathmatics) | **No** — Five to Nine makes no spend/reach/impression claims. |

The essay's FAQ defines the category boundary in Five to Nine's favor: "spy
tools show you ads; intelligence platforms organize monitoring, trends, and
**alerts**" — Five to Nine is the latter. Its honest differentiator vs. the
monitoring shelf: **screenshot evidence + source-linked proof for every
confirmed change** (Meta Ad Library's stated weakness in the essay is "no
history for ended ads" and no monitoring; AdSpy/BigSpy are "massive,
searchable, occasionally stale" databases). Five to Nine's coverage is
Meta-ads + public landing pages only — state that plainly, it is a feature
(the landing-page layer is the essay's "how to find competitor ads" step) and
not a claim we overstate.

## Submission status (recorded 2026-08-11)

**NEEDS-NISH — ready to send; the send step itself is the only remaining
action.** Recorded 2026-08-11:

**NEEDS-NISH: send the prepared email from `support@0509.io` to
`hello@ad-stack.ai`.**

- **No account, form, or payment required** — unlike SaaSHub/AlternativeTo
  there is no registration, and unlike BetaList there is no paid tier. The
  venue's entire submission path is one email to `hello@ad-stack.ai` with a
  short description and a public link.
- **No repo-local outbound mail path exists** to fire the email from this
  worktree: the only outbound sender in the product is the production
  Worker's Cloudflare `send_email` binding (`EMAIL_FROM_EMAIL: alerts@0509.io`,
  used for digests/alerts), which requires production secrets/deploy and is
  not appropriate for a one-off vendor email. The prepared email therefore
  waits on the sender — exact next step: **send the email below from
  `support@0509.io` (the live, verified `0509.io` mailbox) to
  `hello@ad-stack.ai`**; pasting it in takes under a minute.
- **No coverage guarantee, by design** — the venue says it can't promise
  coverage and being suggested has no bearing on the verdict. This is a
  submission for the next quarterly re-test, not a confirmed placement; do
  not record it as "listed" until the venue replies or the re-test publishes.

- **NEEDS-NISH reconfirmed 2026-08-21** (lane-3 freshness pass, ten days after the
  2026-08-11 prep landed on main via PR #628): the venue's submission path
  (About page + FAQ Q-04), no-pay-to-play rule (About page + FAQ Q-01),
  quarterly re-test cadence (FAQ Q-03), essay URL, and eight-tool ranking
  list (Superscale #1 → SpyFu #8, published 2026-07-15) are all unchanged
  on `https://ad-stack.ai`. Every `0509.io` URL the submission copy cites
  is still HTTP 200, and the plan facts in the email body still match
  `app/lib/plan-entitlements.ts` exactly. Evidence record:
  `.lane/reports/0509-lane3-adstack-listing-fresh-verification-2026-08-21.md`.
  No corrections needed to the prep; the email below is still paste-ready,
  the sender is still the unblock owner step.

## Ready-to-send submission (the whole submission is one email)

To: `hello@ad-stack.ai`
From: `support@0509.io` (send when the owner gives the word — see
[Exact next step](#exact-next-step-owner-decision))
Subject: `Tool for your ad-intelligence ranking: Five to Nine (competitor ad monitoring, with evidence)`

> Hi ad-stack team,
>
> Tool for your ad intelligence coverage: **Five to Nine**
> (https://0509.io) — competitor ad and landing-page monitoring where every
> change alert carries screenshot evidence and a source link you can open
> yourself.
>
> Five to Nine watches competitors' Meta ads and public landing pages,
> compares each check against a baseline, and sends one alert per confirmed
> change — plus a quiet heartbeat when nothing moved, so silence always
> means we looked. Paste a competitor site at https://0509.io/search to
> preview the ads they're running right now, no account needed. Paid plans
> check every 3–6 hours; the free plan covers one competitor with a weekly
> email brief.
>
> Where it fits your ranking: the monitoring shelf next to Foreplay and the
> Meta Ad Library, with proof attached (that's our whole bet — the library
> gives you raw ads, we give you what changed and when). We're honest about
> the edges: Meta ads are the automated channel today, landing pages are
> public-web, and we don't do spend estimates.
>
> Happy to give you a seat (free plan or paid, your pick — you pay for your
> own seats anyway, per your FAQ) if you'd like to run it through your
> twelve-metric protocol for the next quarterly re-test.
>
> Best,
> Five to Nine

### Why this copy (mapped to the venue's stated rules)

- **"a short description and a public link"** (About page) — the body is one
  screen, leads with name + URL, and gives the honest one-line category.
- **"Same brief … Twelve metrics"** protocol — the email offers a seat for
  their real protocol instead of asking for favorable placement; this
  matches their no-pay-to-play stance and "we pay for our own seats" FAQ.
- **Fit framing** uses their own shelf taxonomy ("monitoring shelf next to
  Foreplay and the Meta Ad Library") and their own category definition
  (organize monitoring and alerts, not just show ads).
- **Edges stated up front** (Meta-only automation, no spend estimates) —
  matches the repo's honest-claims guardrails; the venue's editorial voice
  says it "would rather be specific than diplomatic".

## Honesty guardrails (do not claim in the email)

Same rules as the SaaSHub/BetaList preparations, sourced from `MEMORY.md`,
`README.md`, and the live homepage copy (`app/routes/marketing.tsx`):

- **No WhatsApp delivery claims** — WhatsApp is dormant and not part of the
  public offer. Slack and Teams incoming-webhook delivery of confirmed changes
  is a live Starter+ channel (2026-08-12 decision); the legacy Slack
  export/API/MCP surface remains dormant and unclaimed.
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
  tracking remains beta until the production canary graduates.
- **Use `0509.io` everywhere** — `0509.in` is legacy redirect-only and must
  not appear in the email, links, or any follow-up.

## Live URLs referenced (re-verified 2026-08-11, all HTTP 200)

- `https://0509.io` — product home (canonical tagline live in
  `app/routes/marketing.tsx`: "Know when competitors change the offer.")
- `https://0509.io/auth/signup` — working email magic-link signup.
- `https://0509.io/search` — public search preview, no account needed.
- `https://0509.io/compare/magicbrief` — MagicBrief migration guide
  (relevant if ad-stack ever compares against MagicBrief).

## Submission process (verified from ad-stack.ai pages, 2026-08-11)

1. Email `hello@ad-stack.ai` with the short description + public link (text
   above, ready to paste). No account, no form, no payment.
2. The venue reads every submission but **promises no coverage**; being
   suggested has no bearing on the verdict (About page, FAQ Q-04).
3. Reviews run their own protocol and pay for their own seats at the public
   plan tier; there is nothing to buy or sponsor (FAQ Q-01, About page).
4. The ranking essay re-tests quarterly (FAQ Q-03) — a submission now lands
   Five to Nine in the queue for the next full re-test of
   `best-ad-intelligence-software-2026` (~October 2026). A field note
   between cycles is possible but at the venue's discretion.
5. Track: any reply from `hello@ad-stack.ai` is the signal the submission
   landed; a listing would appear as a new or re-ranked entry in the essay
   and is verifiable at the essay URL.

## Exact next step (owner decision)

1. **Send the prepared email from `support@0509.io` to `hello@ad-stack.ai`.**
   That is the whole submission — no other venue step exists. (Optional:
   copy the same body to the venue's newsletter contact if a reply doesn't
   arrive within ~2 weeks; the About page contact is the same address.)
2. After sending, record the send date + any reply under
   [Submission status](#submission-status-recorded-2026-08-11) so the fleet
   knows this venue is no longer pending.
3. If the venue responds with a review invitation, follow their protocol
   (they will ask for a seat at the public plan tier; the free Scout plan is
   the honest baseline, paid seats are the owner's call).
4. Never pay for placement — the venue states placement is not for sale and
   the repo's budget policy has no listing-purchase line.

After the send, this venue's part of the item is complete; "listed" itself
depends on the venue's editorial re-test, which no amount of preparation can
guarantee — recorded honestly here rather than assumed.
