# MagicBrief migration blitz — in-repo implementation is fully shipped (lane 1 evidence)

**Status: evidence record — the in-repo blitz is implemented and shipped on
origin/main. Only human-blocked owner actions remain; no product code is
touched by this lane.**

Branch: `0509-lane1-magicbrief-blitz-fully-resolved`
Base: `origin/main` at `59243e7f` (#799)

## Item

- [ ] MagicBrief migration blitz — TIME-SENSITIVE: capture MagicBrief's
      wind-down buyers now; the migration page exists, the blitz does not
      [source: consolidated-gap-v1] [tier-3] [risk: amber] [traction]
      [time-sensitive] [unreviewed-by-opus]

## Verdict

The item's in-repo portion is **already implemented** across the merged PRs
listed below; all are ancestors of the current `origin/main` HEAD (`59243e7f`).
The "blitz" — search-intent SEO on the migration page, primary migration CTA
plus attributable signup message, rejected-columns panel on the competitor
import preview, the venue-by-venue blitz playbook, and the prepared
AlternativeTo / SaaSHub / ad-stack.ai directory listings — ships on main.

The only remaining actions are **owner-blocked** (Nish account sign-in,
venue-terms confirmation, ad-stack.ai email send, toolbit.ai claim, and
post-approval suggest-as-alternative steps). None of those actions can be
performed from this repo: there is no repo-local outbound mail path (the
product's only sender is the production Worker `send_email` binding, which
is not used for one-off vendor mail), and the directory listings require
verified human accounts. This lane's deliverable is this evidence record,
matching the established pattern for already-resolved items
(`0509-lane1-magicbrief-migration-cta`, `0509-lane1-magicbrief-rejected-columns-panel`,
`0509-lane1-alternativeto-listing-fresh-verification`,
`0509-lane1-saashub-listing-opus-review`).

## What the in-repo blitz ships (acceptance mapping, every claim verified)

Each merge below is an ancestor of `origin/main` HEAD — verified by
`git merge-base --is-ancestor <sha> origin/main` (all true).

- **PR #643 (`b21cc135`, "blitz: capture MagicBrief wind-down buyers —
  search-intent SEO on migration page + venue playbook")** — `app/routes/compare.magicbrief.tsx`
  retitled to "MagicBrief alternative: Five to Nine | Migration guide";
  meta description now leads with "MagicBrief alternative"; a 4-question
  FAQ section added answering the queries displaced buyers actually type
  ("What happened to MagicBrief?", "Is Five to Nine a MagicBrief
  alternative?", "What actually moves from MagicBrief?", "What does
  switching cost?"); one `application/ld+json` FAQPage script emitted via
  `faqPageJsonLd` / `jsonLdScriptProps`; every FAQ answer is grounded in
  existing page copy — no new promises. `docs/magicbrief-blitz-capture-2026-08-12.md`
  added with the venue-by-venue capture plan and honesty guardrails.
- **PR #711 (`80456584`, "blitz: capture MagicBrief wind-down buyers on the
  migration page + signup")** — primary migration CTA on
  `/compare/magicbrief`: a visible `.ld-cta-button` reading
  "Start migration →" → `/auth/signup?source=magicbrief-migration`; a
  secondary person-to-person plan-migration section. `/auth/signup` shows a
  migration-path message for visitors arriving with
  `?source=magicbrief-migration` (same-screen path: signup → setup
  checklist's competitor import → watchlists); silent for other sources and
  once the setup link is sent. Styling: `.ld-migration-cta` and
  `.ld-cta-button` in `app/app.css`.
- **PR #719 (`9863579b`, "docs(lane): record evidence that the MagicBrief
  migration CTA is implemented by PR #711 (lane 1)")** — companion evidence
  record (this lane's pattern source).
- **PR #754 (`e49755a2`, "blitz: surface rejected CSV columns in the
  competitor import preview")** — `app/components/setup-checklist-card.tsx`
  `ImportPreview` now renders a "Columns not imported" panel listing every
  `preview.rejectedColumns` entry, with a keep-your-original-file pointer.
  MagicBrief exports carrying `board` / `analytics_*` columns now show
  exactly which columns do not transfer, inside the existing honest
  boundary. `preview.rejectedColumns` is the parser/preview data contract,
  proven by `tests/magicbrief-migration.test.ts`. `.f9-import-rejected`
  panel styles added in `app/app.css`.
- **PR #664 (`7264236e`, "docs: AlternativeTo listing assets")** — squared
  512x512 transparent icon (`docs/assets/alternativeto/five-to-nine-icon-512.png`
  + squared SVG source `five-to-nine-icon.svg`), homepage screenshot
  (`screenshot-homepage.png`, 1280x900), public search results screenshot
  with a real example query (`screenshot-search-results.png`, Flipkart via
  the no-account preview), and the pre-search form state
  (`screenshot-search-preview.png`). All captured from the live `https://0509.io`
  on 2026-08-12; all content is public (no account surfaces, no personal
  data). Committed to the repo so the AlternativeTo submission no longer
  waits on any asset work.
- **PR #574 (`69cfcbc0`, "docs(marketing): prepare manual SaaSHub listing
  for Five to Nine")** and the follow-up re-verification PRs #743, #744,
  #760 — `docs/saashub-listing-2026-08-11.md` (canonical receipt, with
  MagicBrief included in the competitor list per the blitz doc's
  "If MagicBrief is still listed at submission time, include it" note),
  `docs/alternativeto-listing-2026-08-11.md` (with MagicBrief conditional
  target 0), and `docs/venue-submissions-status-2026-08-11.md` (single
  status page).
- **PR #628 (`49ceb3e3`, "docs: ad-stack.ai listing 2026-08-11")** —
  `docs/adstack-listing-2026-08-11.md`, the one-email submission to
  `hello@ad-stack.ai` (no account, form, or payment required).
- **PR #519 (`01be4658`, "fix: make public MagicBrief migration promise
  truthful")** and **PR #538 (`35f264a5`, "fix: align MagicBrief migration
  CTA with supported imports")** — earlier closed MagicBrief items that
  shipped the honest migration promise and the supported-imports boundary.
  Together they are the foundation the blitz layered on top of.

## What ships live on `https://0509.io/compare/magicbrief` (page-level)

- `<title>` → "MagicBrief alternative: Five to Nine | Migration guide".
- `<meta name="description">` → "MagicBrief alternative: your competitor
  list imports as watchlists; collections, boards, and analytics history
  do not transfer. See what moves." (143 chars, leads with the keyword).
- "What imports." grid (2 cards): tracked brands → watchlists (with notes,
  tags, client labels); preview-before-commit + keep-your-original-file
  rule.
- "Not imported" grid (3 cards): collections / boards, analytics / report
  history, historical evidence — the honest boundary.
- "The honest differences" grid (3 cards): monitors changes, not just
  creatives; receipts for every move; honest limits on Meta ads.
- FAQ section "MagicBrief wind-down questions, answered honestly." — 4 Q/A
  pairs wired to `<dl class="proof-trail-list">`, plus one
  `application/ld+json` `FAQPage` block.
- `.ld-migration-cta` section: kicker "Start migrating", heading "Import
  your competitor list now.", body restating the not-imported boundary,
  primary `.ld-cta-button` "Start migration →" → `/auth/signup?source=magicbrief-migration`.
- Person-to-person "Plan your migration" final section linking
  `support@0509.io`.
- `canonicalLinks("/compare/magicbrief")` for the canonical URL.

## Migration guide doc — `docs/magicbrief-migration.md`

Lays out the executable promise end-to-end:

- Supported inputs (paste lines, CSV with recognized headers, positional
  fallback).
- Accepted-header table (`name`, `website`, `notes`, `tags`, `client`).
- Rejected-but-reported columns via `preview.rejectedColumns` and the new
  "Columns not imported" panel on the preview.
- Manual fallback (export what MagicBrief still offers → build a competitor
  list → paste/upload into setup import → recreate what the import does
  not carry → email support).
- Illustrative sanitized fixture (no customer data) showing exactly which
  columns the import maps and which it reports as not imported.

## Honesty guardrails (unchanged, bind this blitz)

- The page's not-imported boundary stays: collections, boards, analytics
  history, and past evidence do **not** transfer; no full MagicBrief
  export contract is claimed. FAQ answers repeat those limits, they do not
  soften them.
- No waiting-list or email-capture promises: the capture CTA is the public
  search preview ("Try it free, no account") plus
  `support@0509.io`.
- Listing copy rules apply (no UTM on AlternativeTo, no India-only
  framing, no Slack/WhatsApp/unlimited claims, `0509.io` only).

## Verification run (this lane)

```
node_modules/.bin/vitest run --configLoader runner \
  tests/compare-magicbrief.route.test.ts \
  tests/auth-signup-magicbrief.test.ts \
  tests/marketing-magicbrief-cta.test.ts \
  tests/magicbrief-migration.test.ts \
  tests/competitor-import.test.ts \
  tests/dashboard-activation.route.test.ts \
  tests/funnel-seo.test.ts \
  tests/seo.test.ts
```

```
 Test Files  8 passed (8)
      Tests  72 passed (72)
   Duration  1.90s
```

- `tests/compare-magicbrief.route.test.ts` — pins the canonical URL,
  honest meta, public search CTA, support contact, the primary migration
  CTA (`href="/auth/signup?source=magicbrief-migration"`, "Start
  migration", "Import your competitor list now.", honest boundary next to
  the CTA, no overclaims).
- `tests/auth-signup-magicbrief.test.ts` — pins the signup migration
  message for `source=magicbrief-migration`, its honest boundary, silence
  for other sources, and silence once the setup link is sent.
- `tests/marketing-magicbrief-cta.test.ts` — pins the homepage CTA
  boundary and the migration-guide link.
- `tests/magicbrief-migration.test.ts` — pins the rejected-column panel
  (asserts the panel is documented and the old limitation phrase is gone),
  the manual fallback, and the boundary language.
- `tests/competitor-import.test.ts`, `tests/dashboard-activation.route.test.ts`,
  `tests/funnel-seo.test.ts`, `tests/seo.test.ts` — all green; these gate
  the surrounding surfaces the migration page depends on.

No typecheck / build run needed: this lane touches documentation only.

## Remaining owner actions (human-blocked, per blitz doc)

In priority order, none of which can be done from this repo:

1. **Submit the prepared directory listings** — `docs/alternativeto-listing-2026-08-11.md`
   (free, needs a verified AlternativeTo account) and
   `docs/saashub-listing-2026-08-11.md` (free, needs SaaSHub Terms/Privacy
   confirmation in Nish's logged-in Mac browser). MagicBrief is included
   in the SaaSHub competitor list per the blitz doc.
2. **toolbit.ai alternative claim** — add Five to Nine to the MagicBrief
   page's Alternatives tab (115.5k visits/month per the blitz doc).
   toolbit's add/claim flow at submission time, owner action only.
3. **Send the ad-stack.ai email** — `docs/adstack-listing-2026-08-11.md`,
   one email from `support@0509.io` to `hello@ad-stack.ai`. No account,
   form, or payment required; the only blocker is that no repo-local
   outbound mail path exists.
4. **Post-approval suggest-as-alternative** on AlternativeTo (MagicBrief
   page) and SaaSHub (MagicBrief page) once the listings are approved. The
   2026-08-14/15 fresh-verification pass confirmed MagicBrief is **not on
   AlternativeTo** (404), so the AlternativeTo MagicBrief-page step is a
   no-op; the SaaSHub step is post-approval and owner-run.
5. **Measure**: filter analytics for referer `alternativeto.net`, source
   `saashub`, and organic queries containing "magicbrief"; the FAQPage
   rich result on `/compare/magicbrief` is the in-site conversion
   surface.

## Why no new PR was opened

The item's in-repo fix is already merged and live on `origin/main`.
Re-implementing it would fork or duplicate shipped work; the productive
action is this evidence record, matching the lane pattern used for prior
already-resolved items (`0509-lane1-magicbrief-migration-cta` for PR #711,
`0509-lane1-magicbrief-rejected-columns-panel` for PR #754,
`0509-lane1-alternativeto-listing-fresh-verification` for PR #743).

## Files

- `.lane/reports/0509-lane1-magicbrief-blitz-fully-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
