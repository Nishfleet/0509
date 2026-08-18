# MagicBrief wind-down capture — the blitz

MagicBrief announced its wind-down (shutdown 2026-07-31 8pm EST; team moved to
Canva Grow) and its buyers are choosing replacements now. This page and its
sibling docs are the product-side blitz: turn the honest migration page into a
capture funnel and record where the displaced buyers are.

## What ships in the product

- `/compare/magicbrief` (live) — the migration guide. Honest boundary: a
  competitor list (paste or CSV) imports as watchlists with notes, tags, and
  client labels; collections, boards, analytics history, and past evidence do
  not transfer and are recreated with person-to-person help.
- **Primary migration CTA** — a visible "Start migration" button on
  `/compare/magicbrief` linking to `/auth/signup?source=magicbrief-migration`.
  Before this, the only on-page actions were the generic search preview and a
  support email, so wind-down traffic landed in a conversion dead end.
- **Signup migration message** — visitors arriving at signup with
  `?source=magicbrief-migration` see the migration path in the same screen
  (competitor list → setup checklist import → watchlists), inside the same
  honest boundary. The message never promises full transfer.
- **Capture measurement** — the `source=magicbrief-migration` marker rides the
  signup URL, so wind-down capture is attributable in analytics and
  referral/signup logs.

## Venues and owner actions

- **SaaSHub** — MagicBrief page verified live; Five to Nine can list as an
  alternative. Owner step: claim/submit the prepared listing.
- **toolbit.ai** — MagicBrief alternatives page (~115.5k visits/mo in research).
  Owner step: claim Five to Nine and add it as an alternative.
- **AlternativeTo** — MagicBrief listing; suggest-as-alternative is conditional
  on the page being listed at submission time (bot-blocked in verification).
- **Google wind-down queries** — "MagicBrief alternative", "what happened to
  MagicBrief": covered by the SEO retitle/FAQ on `/compare/magicbrief`
  (PR #643) plus this CTA.

## Honesty guardrails

- The migration page and signup message only promise what the import actually
  moves: competitor lists become watchlists. Collections, boards, analytics
  history, and past evidence are explicitly not migrated.
- No "we migrate everything" framing anywhere. The not-imported boundary is
  restated next to every capture action.
- No fabricated export-format parity: MagicBrief's export options are
  verified only against its public FAQ, and that surface is not under our
  control.

## Rollback

Revert the CTA block and the signup message only; the migration page, the
import path, and the honest copy are untouched.
