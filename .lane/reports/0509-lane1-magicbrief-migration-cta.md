# /compare/magicbrief conversion dead end — already implemented by PR #711 (merged)

**Status: evidence record — the item is implemented and shipped on origin/main.
No product code touched by this lane.**

Branch: `0509-lane1-magicbrief-migration-cta`
Base: `origin/main` at `7e7c2bc0` (#716)

## Item

- [ ] /compare/magicbrief is a conversion dead end — zero migration CTAs on the
      wind-down capture page; the only action

## Verdict

The item is **already implemented** by PR #711 (`blitz: capture MagicBrief
wind-down buyers on the migration page + signup`, commit `80456584`), which is
**merged into origin/main** — verified in this worktree with
`git merge-base --is-ancestor 80456584 origin/main` (true). No new code is
needed; the lane's deliverable is this evidence record.

## What PR #711 ships (acceptance mapping)

- **Primary migration CTA on `/compare/magicbrief`** — a visible
  `Start migration` button (`.ld-cta-button`) in the final CTA section, linking
  to `/auth/signup?source=magicbrief-migration`, plus a secondary person-to-
  person plan-migration section. Before the PR, the only on-page actions were
  the generic search preview form and the support email — exactly the dead end
  the item names.
  - File: `app/routes/compare.magicbrief.tsx` (`MIGRATION_SIGNUP_PATH`,
    `.ld-migration-cta` section).
- **Honest boundary preserved next to every capture action** — the not-imported
  boundary (collections, boards, analytics history, past evidence) is restated
  beside the CTA; no "we migrate everything" framing anywhere.
- **Signup capture message** — `/auth/signup` shows a migration-path message for
  visitors arriving with `?source=magicbrief-migration` (same-screen path:
  signup → setup checklist's competitor import → watchlists), inside the same
  honest boundary; silent for other sources and once the setup link is sent.
  - File: `app/routes/auth.signup.tsx`
    (`magicbriefMigrationMessage` in the loader).
- **Attributable capture measurement** — the `source=magicbrief-migration`
  marker rides the signup URL, so wind-down capture is attributable in
  analytics and referral/signup logs.
- **Styling** — `.ld-migration-cta` and CTA-button styles added in
  `app/app.css`.
- **Capture blitz doc** — `docs/magicbrief-blitz-capture.md` (venue plan and
  honesty guardrails).

## Verification run (this lane)

Affected test files on current main — **3 files / 17 tests passed**:

```
npx vitest run --configLoader runner \
  tests/compare-magicbrief.route.test.ts \
  tests/auth-signup-magicbrief.test.ts \
  tests/marketing-magicbrief-cta.test.ts
```

- `tests/compare-magicbrief.route.test.ts` — 9 tests: pins the canonical URL,
  honest meta, public search CTA, support contact, and the primary migration CTA
  (`href="/auth/signup?source=magicbrief-migration"`, "Start migration",
  "Import your competitor list now.", honest boundary next to the CTA, no
  overclaims).
- `tests/auth-signup-magicbrief.test.ts` — 4 tests: pins the signup migration
  message for `source=magicbrief-migration`, its honest boundary, silence for
  other sources, and silence once the setup link is sent.
- `tests/marketing-magicbrief-cta.test.ts` — 4 tests: pins the homepage CTA
  boundary and the migration-guide link.

No typecheck/build run needed: this lane touches documentation only.

## Why no new PR was opened

The item's fix is already merged and live on `origin/main`. Re-implementing it
would fork or duplicate shipped work; the productive action is this evidence
record, matching the lane pattern used for prior already-resolved items (e.g.
`b6315245` same-session first value via PR #631, `b8bfc61e` VPS sshd incident).

## Files

- `.lane/reports/0509-lane1-magicbrief-migration-cta.md` — this evidence
  record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
