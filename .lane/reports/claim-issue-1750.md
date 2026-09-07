# claim/issue-1750 — post-merge follow-up for #1750 no_ads terminal state

## Issue

Nishfleet/0509#1750 — BET 7 first brief in-session honest "no verified ads yet" state.

## Worktree

- Branch: `claim/issue-1750`
- Base at start: `89b91e2e43c4020ea048d9791dac560c532a2e55`
- Current branch head after rebase on latest `origin/main`: `75cfe6ab`

## What changed

- `app/routes/app.onboard.tsx` — capture `ensureFirstBriefForWorkspace` filing result and keep `waiting` when filing fails (`create_failed`) instead of freezing on `no_ads`.
- `app/components/signup-first-brief-view.tsx` — use the shared `SignupFirstBriefLoaderData` type.
- `tests/activation/first-brief-same-session.test.tsx` — add `no_ads` render test and `create_failed` waiting test.

The original no_ads state and multi-watchlist detection were merged in PR #1795. This PR is the post-merge reviewer follow-up.

## Verification

- `npx vitest run --configLoader runner --project workers tests/integration/signup-first-brief.integration.test.ts` — 5/5 passed
- `npx vitest run --configLoader runner --project node tests/activation/first-brief-same-session.test.tsx tests/funnel-measurement.test.ts tests/watchlists-competitor-import.test.ts tests/onboarding.route.test.ts` — 62/62 passed
- `npm test` — 583 node files / 6,950 tests + 24 workers files / 132 tests passed
- `npm run typecheck` — clean
- `npm run build` — success
- `sgscan --base origin/main` — no findings
- `npx playwright test --config=playwright.config.ts --project=workspace tests/e2e/activation-first-brief.spec.ts` — 1 passed (53.7s)
- `fleet-exec-review-canary`, `prove-one-run-check`, `fleet-rebuild-verify-check`, `research-before-build-check`, `fleet-token-efficiency-check`, `fleet-no-agent-names-check` — all OK

## Reviewer

- Seat: `cursor` / `cursor-grok-4.6-high`
- Findings acted on: filing-failure polling freeze, missing no_ads render test, `.some` + `.find` cleanup.

## Result

Branch pushed to `origin/claim/issue-1750` at `75cfe6ab`. Ready for new PR.
