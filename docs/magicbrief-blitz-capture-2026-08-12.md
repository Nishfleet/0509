# MagicBrief wind-down capture blitz (prepared 2026-08-12)

**Item:** MagicBrief migration blitz — TIME-SENSITIVE: capture MagicBrief's
wind-down buyers now; the migration page exists
[Tier 3 growth, Consolidated 0509 queue #11]

**Situation (recorded 2026-08-12):** MagicBrief shut down 2026-07-31. Its
buyers are choosing replacements RIGHT NOW and every week of delay hands
them to Foreplay / Skaler / Canva. The product-side capture asset already
exists and ships: the migration guide at `https://0509.io/compare/magicbrief`
(imports competitor lists as watchlists, honest not-imported boundary,
person-to-person fallback). This document is the blitz: where displaced
buyers actually are, what is done in this repo, and the exact owner actions
to convert them.

## What ships with this blitz (merged work)

- **Search-intent capture on `/compare/magicbrief`** (this branch): page now
  titles itself "MagicBrief alternative: Five to Nine | Migration guide",
  carries a four-question FAQ section answering the queries displaced buyers
  type ("What happened to MagicBrief?", "Is Five to Nine a MagicBrief
  alternative?", "What actually moves from MagicBrief?", "What does switching
  cost?"), and emits one schema.org FAQPage JSON-LD block. Every answer is
  grounded in existing page copy — no new promises. Meta description leads
  with "MagicBrief alternative" at 143 chars. Proven by
  `tests/compare-magicbrief.route.test.ts` (10 tests) and the SEO/funnel
  suites.
- **Rejected-column panel on the import preview** (this branch): the
  Market Desk setup import preview now lists unknown CSV columns
  ("Columns not imported") instead of only showing row-level statuses.
  MagicBrief exports carry `board`/`analytics_*` columns; buyers now see
  exactly which of their columns do not transfer, inside the honest
  boundary. `preview.rejectedColumns` is the data contract, proven by
  `tests/magicbrief-migration.test.ts`.
- **AlternativeTo suggest-as-alternative target** added to
  `docs/alternativeto-listing-2026-08-11.md`: MagicBrief's page is where
  wind-down buyers browse for replacements (target 0, conditional on the
  page still being listed — AlternativeTo blocks bot fetches, so verify at
  submission time).

## Where the displaced buyers are (verified surfaces)

| Venue | Evidence | Capture action |
|---|---|---|
| `https://www.toolbit.ai/ai-tool/magicbrief` | Live "MagicBrief: Reviews, Features, Pricing, Alternatives" page, ~115.5k monthly visits, captured in research-desk last30days 2026-08-10 | Add/claim Five to Nine as a listed alternative on the page's Alternatives tab. Highest-volume venue. |
| SaaSHub `https://www.saashub.com/magicbrief` | Verified live 2026-08-10 in `docs/saashub-listing.md` ("returned a real product page, not 404") | 1) Include MagicBrief in the SaaSHub submission's competitor list (already drafted in `docs/saashub-listing-2026-08-11.md`: "If MagicBrief is still listed at submission time, include it"). 2) Post-approval, SaaSHub auto-generates alternatives pages — MagicBrief buyers then see Five to Nine. |
| AlternativeTo `/software/magicbrief/` | Page exists per directory convention; bot fetch returns 403, so verify at submission | Suggest Five to Nine as an alternative on MagicBrief's page (post-approval of the AlternativeTo listing) — added as target 0 in `docs/alternativeto-listing-2026-08-11.md`. |
| Google search: "MagicBrief alternative", "MagicBrief shut down", "MagicBrief closing", "MagicBrief replacement" | Search intent of displaced users; captured by the FAQ/JSON-LD work above | The migration page now targets these queries with a FAQPage entity and alternative phrasing in title/meta. |
| YouTube "MagicBrief is Ending" content | 2026-07-21 video in research artifacts | Read-only context — no inauthentic engagement per listing honesty rules. |

## Owner actions (blocked on human, in priority order)

1. **Submit the prepared directory listings** — the free AlternativeTo and
   SaaSHub submissions in `docs/alternativeto-listing-2026-08-11.md` and
   `docs/saashub-listing-2026-08-11.md` are PREPARED, NOT SUBMITTED and need
   account sign-in + a few owner-decided fields. Both are the venues where
   displaced buyers browse alternatives. (ad-stack.ai prep also exists on
   branch `docs/adstack-listing-2026-08-11`.)
2. **toolbit.ai alternative claim** — add Five to Nine to the MagicBrief
   page's Alternatives tab (115.5k visits/month). Check toolbit's
   add/claim flow at submission time.
3. **Post-approval suggest-as-alternative** on AlternativeTo (MagicBrief
   page) and SaaSHub (MagicBrief page) once listings are approved.
4. **Measure**: filter analytics for referer `alternativeto.net`, source
   `saashub`, and organic queries containing "magicbrief"; the FAQPage rich
   result on `/compare/magicbrief` is the in-site conversion surface.

## Honesty guardrails (unchanged, bind this blitz)

- The page's not-imported boundary stays: collections, boards, analytics
  history, and past evidence do NOT transfer; no full MagicBrief export
  contract is claimed. FAQ answers repeat those limits, they do not soften
  them.
- No waiting-list or email-capture promises: the capture CTA is the public
  search preview ("Try it free, no account") plus `support@0509.io`.
- Listing copy rules from the venue docs apply (no UTM on AlternativeTo,
  no India-only framing, no Slack/WhatsApp/unlimited claims, `0509.io` only).
