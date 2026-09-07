# Lane evidence — 0509-lane1-llms-live-search-dodo-checkout

## Item

Rewrite `/llms.txt` (and `PUBLIC_MARKDOWN`) so AI answers can cite live public search and live Dodo checkout.

## Changes

- `app/lib/public-markdown.ts`: appended AI-citable clauses for public search in both `PUBLIC_MARKDOWN` and `LLMS_TEXT`; replaced Dodo checkout hedge with confident production-canary wording; moved checkout from "needs proof" to "live" in honesty summary.
- `tests/public-markdown.test.ts`: updated `labels configured capability separately from live proof` test to pin new confident wording and assert stale hedge removed from markdown copy.

## Verification

- `npx vitest run tests/public-markdown.test.ts --configLoader runner` — 5/5 passed
- `npm run typecheck` — exit 0
- `npm run test` — 27 failures pre-exist on `origin/main` (workspace-seats and others); unchanged by this diff
- `git grep "final owner-run provider smoke is recorded"` — no hits in copy files; only appears in test negative assertion per spec

## Diff scope

Only `app/lib/public-markdown.ts` and `tests/public-markdown.test.ts`.
