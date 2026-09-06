# Lane 1 report — MagicBrief migration blitz (0509)

Branch: `0509-lane1-magicbrief-rejected-columns-panel`
PR: https://github.com/Nishfleet/0509/pull/754

## Outcome

Completed the last in-repo gap the MagicBrief blitz itself flagged: the
competitor import preview now surfaces rejected CSV columns in a visible
"Columns not imported" panel instead of only reporting them through the
`preview.rejectedColumns` data contract. MagicBrief wind-down buyers whose
exports carry `board`/`analytics_*` columns now see exactly which columns
do not transfer, inside the existing honest boundary.

## What was already done (verified, not re-built)

The migration guide (`/compare/magicbrief`) and its search-intent capture
shipped in PR #643; the migration CTA + signup message shipped in PR #711.
The parser already returned `preview.rejectedColumns` (proven by
`tests/magicbrief-migration.test.ts`); only the UI panel was missing, and
both `docs/magicbrief-migration.md` and the blitz doc pinned that gap.

## Changes

- `app/components/setup-checklist-card.tsx` — `ImportPreview` renders a
  "Columns not imported" note listing each `preview.rejectedColumns` entry,
  with a keep-your-original-file pointer.
- `app/app.css` — `.f9-import-rejected` panel (light + dark tokens).
- `docs/magicbrief-migration.md` — replaced the "no dedicated
  rejected-column panel" limitation with the panel behavior in three spots
  (rejected/reported, manual fallback, fixture summary).
- `docs/magicbrief-blitz-capture-2026-08-12.md` — added the panel as a
  shipped blitz asset.
- `tests/magicbrief-migration.test.ts` — docs-pinning test now asserts the
  panel is documented and the old limitation phrase is gone.

## Evidence

- `tests/magicbrief-migration.test.ts` (12), `tests/competitor-import.test.ts`,
  `tests/compare-magicbrief.route.test.ts`, `tests/marketing-magicbrief-cta.test.ts`,
  `tests/auth-signup-magicbrief.test.ts`, `tests/dashboard-activation.route.test.ts` — green.
- `npm run typecheck` — clean.
- Pre-existing failure not caused by this change: `tests/setup-checklist-feedback-precedence.test.tsx`
  fails with `act is not a function` (happy-dom/react 19) on clean `origin/main`
  (3 of 3 baseline tests fail there; verified by stashing and by checking out the
  untouched main version of the file).

## Remaining owner actions (human-blocked, per blitz doc)

Venue submissions (AlternativeTo, SaaSHub, toolbit.ai claim) and post-approval
suggest-as-alternative steps remain owner actions; they are prepared but not
submitted and cannot be done from the repo.
