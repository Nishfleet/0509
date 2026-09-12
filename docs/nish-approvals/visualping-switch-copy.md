# NISH copy approval: Visualping switch page (`/switch/visualping`)

Issue: Nishfleet/0509#3020

Every competitor claim on the Visualping switch page is anchored only on
verified public facts — Visualping's own blog plus one cited review locator —
and carries an as-of date beside the claim (the PR #2999 citation-staleness
pattern). This file is the sign-off record for that copy: no editor may change
a line below, or the page copy itself, until Nish signs off with a `[NISH]`
mark in the checklist. A test (`tests/nish-approval-visualping-copy.test.ts`)
fails when the shipped copy in `app/lib/switch-pages.ts` drifts from this
file, so re-approval is forced on any edit.

Status: **publication already predates this record** (landed 2026-08-26,
commit `8d5bc3392`; the page is live and in the sitemap). The claims below are
the shipped copy exactly. Until Nish signs off, this file is the frozen
baseline: edits to the page copy require a matching edit here and a fresh
`[NISH]` mark. If Nish rejects a claim, the fix route is an edit to
`app/lib/switch-pages.ts` plus this file in the same change.

## Shipped copy inventory (from `SWITCH_PAGES.visualping`)

- Kicker: `Switch from Visualping`
- Headline: `Skip the Ad Library URL hunt and the condition prompt.`
- Deck: `Visualping's own blog says the AI classifies 83% of detected changes as not important. Its Meta Ad Library playbook still asks you to find the library URL and write a condition prompt. Five to Nine takes a domain.`
- Card line: `Skip the Ad Library URL hunt and the condition prompt. Five to Nine takes a domain and flags real moves.`
- SEO title: `Visualping alternative for ad libraries | Five to Nine`

## Competitor claims and their first-party sources

| # | Claim | Source | As of |
|---|-------|--------|-------|
| 1 | Across Visualping's platform, the AI classifies 83% of detected changes as not important. | https://visualping.io/blog/how-visualping-cuts-false-positives | 2026-08-08 |
| 2 | Visualping's Meta Ad Library playbook asks you to find the library URL and write a condition prompt. | https://visualping.io/blog/monitor-competitors-meta-ad-libraries | 2026-08-08 |
| 3 | Third-party review locator used as secondary evidence only. | https://softwarefinder.com/legal/visualping/reviews | 2026-08-08 |

Sources 1–2 are the competitor's own blog (first-party admissions). Source 3
is a cited review locator, never used as the primary claim backing.

## What stays gated

- Any change to the deck, headline, complaint quote, card line, FAQ answers,
  or the transfer / does-not-transfer bullets on the page.
- Any sitemap change for `/switch/visualping` (today it IS in
  `ROOT_SITEMAP_STATIC_ENTRIES`; removal or re-addition needs a fresh mark).
- Any claim added that is not backed by a first-party source with an as-of
  date.

## Sign-off checklist

- [ ] `[NISH]` claims reviewed as listed above (2026-08-08 sources still current)
- [ ] `[NISH]` voice approved for the headline / deck / card line
- [ ] `[NISH]` sitemap inclusion (`/switch/visualping`) approved
