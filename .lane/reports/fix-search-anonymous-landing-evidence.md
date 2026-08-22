# Lane report: fix-search-anonymous-landing-evidence

Item: `4ba6d4ebd5`
Branch: `fix-search-anonymous-landing-evidence`
Worktree: `/home/nish/workspaces/agent-worktrees/0509-lane1-20260822-221033`

## Goal

Anonymous `/search?selected=` on a live (non-demo) ad with a `landingPageUrl`
must run fetch-only landing capture. The selected-ad Landing page pane must
show captured signals, `Analyzing creative…` while pending, or an honest gap
(`Couldn't capture this page` / `Unavailable` / `Couldn't check this page`) —
never empty-check placeholders.

## Cause

The search loader set `enrichSelected: Boolean(session) && !providerDeny.enabled`,
so anonymous select never ran capture. Live ads arrive with `landingPage: null`.

## Change

- Anonymous explicit selections: `enrichSelected: true`, `hydratePersisted: false`,
  `allowRenderedFallback: false`.
- Fetch-only landing capture; no OCR, translation, `upsertAd`, or R2 artifacts.
- Metered by `public-search-selection` (30 / 10 min / IP / fail-open).
- Display helpers distinguish pending vs capture-gap vs completed empty check.

## Files

- `app/routes/search.tsx`
- `app/lib/search-selection.server.ts`
- `app/lib/rate-limit.server.ts`
- `app/lib/search-display.ts`
- `app/lib/customer-route-error.ts`
- `tests/search.route.test.ts`
- `tests/search-selection.no-db.test.ts`
- `tests/search-display.test.ts`
- `tests/rate-limit.server.test.ts`
- `tests/search-submission-settle.test.tsx`

Do not retire `4ba6d4ebd5`. Not an evidence-only PR.
