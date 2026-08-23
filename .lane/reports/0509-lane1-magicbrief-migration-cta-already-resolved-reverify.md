# Lane 1 report — /compare/magicbrief migration CTA (already-resolved reverify)

**Status: evidence record — the in-repo migration CTA is shipped on
origin/main. No product code touched by this lane.**

Branch: `0509-lane1-magicbrief-migration-cta-already-resolved-reverify`
Base: `origin/main` at `59243e7f` (#799)

## Item

- [ ] /compare/magicbrief is a conversion dead end — zero migration CTAs on
      the wind-down capture page; the only action …

## Verdict

The item is **already implemented** by PR #711 (commit `80456584`,
"blitz: capture MagicBrief wind-down buyers on the migration page + signup"),
which is **merged into origin/main** — verified in this worktree with
`git merge-base --is-ancestor 80456584 origin/main` (true). No new code
is needed; the lane's deliverable is this evidence record, matching the
established pattern used by prior already-resolved lane records
(`0509-lane1-magicbrief-migration-cta`,
`0509-lane1-magicbrief-rejected-columns-panel`,
`0509-lane1-magicbrief-blitz-fully-resolved`,
`0509-lane1-alternativeto-listing-fresh-verification`,
`0509-lane1-saashub-listing-opus-review`,
`0509-lane1-same-session-first-value`, etc.).

## What the fix ships (acceptance mapping, every claim verified live)

- **Primary migration CTA on `/compare/magicbrief`** — a visible
  `.ld-cta-button` reading "Start migration →" → `/auth/signup?source=magicbrief-migration`
  in the final CTA section (`app/routes/compare.magicbrief.tsx`,
  `MIGRATION_SIGNUP_PATH` line 61, `.ld-migration-cta` block lines 202–216),
  plus a secondary person-to-person plan-migration section (lines 219–231).
  Before the PR, the only on-page actions were the generic search preview
  form and the support email — exactly the dead end the item names.
- **Honest boundary preserved next to every capture action** — the
  not-imported boundary (collections, boards, analytics history, past
  evidence) is restated beside the CTA (line 209–210) and beside the
  person-to-person fallback (line 226–227); no "we migrate everything"
  framing anywhere on the page.
- **Signup capture message** — `/auth/signup` shows a migration-path
  message for visitors arriving with `?source=magicbrief-migration`
  (same-screen path: signup → setup checklist's competitor import →
  watchlists), inside the same honest boundary; silent for other sources
  and once the setup link is sent. Verified in
  `app/routes/auth.signup.tsx` `magicbriefMigrationMessage` (line 59–68).
- **Attributable capture measurement** — the `source=magicbrief-migration`
  marker rides the signup URL, so wind-down capture is attributable in
  analytics and referral/signup logs.
- **Styling** — `.ld-migration-cta` and `.ld-cta-button` styles live in
  `app/app.css` (lines 4583–4642).
- **Companion in-repo work** — PR #643 (`b21cc135`) shipped the
  search-intent SEO on the same page (title "MagicBrief alternative: Five
  to Nine | Migration guide", meta description, FAQ block, FAQPage JSON-LD);
  PR #754 (`e49755a2`) shipped the "Columns not imported" panel on the
  competitor import preview so MagicBrief wind-down buyers whose exports
  carry `board` / `analytics_*` columns see exactly which columns do not
  transfer. All three are ancestors of `origin/main` HEAD.

## Verification run (this lane)

```
node node_modules/.bin/vitest run --configLoader runner \
  tests/compare-magicbrief.route.test.ts \
  tests/auth-signup-magicbrief.test.ts \
  tests/marketing-magicbrief-cta.test.ts \
  tests/magicbrief-migration.test.ts
```

Result: **4 files / 30 tests passed** (`Test Files 4 passed (4)` /
`Tests 30 passed (30)`).

- `tests/compare-magicbrief.route.test.ts` — 9 tests pinning the canonical
  URL, honest meta, public search CTA, support contact, the primary
  migration CTA (`href="/auth/signup?source=magicbrief-migration"`, "Start
  migration", "Import your competitor list now."), the honest boundary next
  to the CTA, no overclaims.
- `tests/auth-signup-magicbrief.test.ts` — 4 tests pinning the signup
  migration message for `source=magicbrief-migration`, its honest boundary,
  silence for other sources, and silence once the setup link is sent.
- `tests/marketing-magicbrief-cta.test.ts` — 4 tests pinning the homepage
  CTA boundary and the migration-guide link.
- `tests/magicbrief-migration.test.ts` — 13 tests pinning the real parser
  against three MagicBrief-shaped fixtures (pasted domains, full CSV, and
  a CSV with `board` / `analytics_*` / `report_date` columns) plus a
  sanitized mixed-row case.

## Why no new PR was opened against product code

The item's fix is already merged and live on `origin/main`. Re-implementing
it would fork or duplicate shipped work; the productive action is this
evidence record, matching how prior lanes close out an item that's been
fully resolved upstream (e.g. `b6315245` same-session first value via PR
#631, `b8bfc61e` VPS sshd incident response, and the
`0509-lane1-magicbrief-*` family this record extends).

## Files

- `.lane/reports/0509-lane1-magicbrief-migration-cta-already-resolved-reverify.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
