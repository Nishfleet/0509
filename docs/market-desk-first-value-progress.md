# Market Desk First Value Progress

Date: 2026-06-30
Branch: `codex/market-desk-first-value-20260628`

## Goal

Turn Five to Nine into a customer-delighting, retention-driving Market Desk:

> Paste your competitors. Wake up to the proof-backed counter-move brief.

The first-session outcome is: within five minutes, a paying customer has a useful baseline brief or an honest queued state.

## Safety Contract

- No fabricated proof, ads, spend, reach, delivery, uptime, or customer examples.
- No customer data, real payment completion, subscription mutation, price change, or public enablement of held channels.
- No direct push to `main`, force push, rebase, history rewriting, unsafe deploy bypass, or unexpected migrations.
- Repository-fixable behavior continues even when external providers, unavailable exports, owner-only dashboard settings, or private workspace config block full live proof.

## Baseline

- `main` and `origin/main` matched at `9a9c3e2278d75789bf9c33420334c2330c62430f`.
- Foreground checkout had one pre-existing untracked artifact: `.playwright-cli/`.
- Pre-work patch saved at `../pre-market-desk-first-value.patch`.
- Worktree created at `.worktrees/market-desk-first-value-20260628`.
- Remote D1 migrations: no pending migrations.
- Local D1 migration list in the fresh worktree shows all migrations unapplied because the local D1 ledger is empty; this is local state, not production drift.

## Baseline Verification

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | Passed | 152 files, 1433 tests |
| `npm run typecheck` | Passed | Existing React Router future warnings and Vite tsconfig-paths notice |
| `npm run build` | Passed | Existing React Router/Vite dynamic import warnings |
| `node scripts/validate-d1-backup.mjs` | Passed | Dry-run, latest migration `0061_support_case_events.sql` |
| `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote` | Passed | No migrations to apply |
| `git diff --check` | Passed | Clean |
| `npm run canary:pricing` | Passed | IN, US, GB pricing previews |
| `npm run canary:billing` | Passed | Internal canary route, plan/top-up cleanup OK |
| `npm run canary:proof` | Passed | Internal canary proof path, one email attempt |
| `npm run canary:prod` | Passed | `0509.io`, `www.0509.io`, `api.0509.io`, fresh-live bypass, ops readiness, Meta ads beta |
| Search V2 dogfood tests | Passed | `tests/search-v2.test.ts`, `tests/search-domain-match.test.ts` |
| `npm run canary:presence` | Blocked | Missing `PRESENCE_INTERNAL_WORKSPACE_ID`; owner-action config, not product failure |

## Agent Ownership

| Agent | Owner Area | Status |
| --- | --- | --- |
| A | Product and activation architecture | Read-only audit completed |
| B | Bulk competitor import and normalization | Implemented and committed |
| C | Search to answer engine | Read-only audit completed |
| D | Market Desk Brief and reports | Read-only audit completed |
| E | Agency and team workflows | Developer/support framing implemented; checkout gates preserved |
| F | Retention, delivery, and customer delight | Dashboard lifecycle moves and support clarity implemented |
| G | Tests, E2E, accessibility, and red team | Focused tests and commit-hook full suite passing; browser QA still pending |

## Decisions

- Build Market Desk Brief as a derived server document first, not a new persistent table.
- Keep client-ready reports proof-strict; scan-backed and proof-pending items can appear in app review states, not as proven client claims.
- Add answer-led search as a pure summary layer over already-hydrated search results; do not alter provider discovery or verified-domain matching logic unless a test proves a mismatch.
- Treat MagicBrief migration as generic competitor-list import unless a real export format is supplied. The public MagicBrief shutdown guidance says analytics reports can export CSV, while other saved work may require manual recreation. The supported-input contract, field dispositions, and manual fallback are documented in [`docs/magicbrief-migration.md`](./magicbrief-migration.md) and locked to the parser by `tests/magicbrief-migration.test.ts`.
- Keep Presence smoke blocked as an owner action until `PRESENCE_INTERNAL_WORKSPACE_ID` is configured.

## Current Owner Actions

- Provide `PRESENCE_INTERNAL_WORKSPACE_ID` if the local Presence canary must be part of the final gate.
- Provide a real MagicBrief competitor export if full field parity beyond generic competitor CSV/text import is required.

## Implemented Commits

| Commit | Result |
| --- | --- |
| `2cad4ff` | Added product audit, experience contract, progress doc, and CE implementation plan. |
| `cd42319` | Added pure competitor import parser and parser tests. |
| `17541e2` | Added paid Market Desk bulk import preview/commit flow to onboarding. |
| `63b25eb` | Added derived Market Desk Brief and dashboard placement. |
| `5d85fb2` | Added evidence-aware answer summary above search results. |
| `9aea279` | Added dashboard retention moves, Developer access framing, API docs boundary copy, and support success clarity. |
| `bb445b7` | Updated Market Desk first-value provenance after implementation verification. |
| Pending | Review hardening: atomic plan-aware watchlist creation, persisted import metadata, fail-closed selected rows, no fabricated search proof, pre-parse import size rejection, parser/header fixes, and standards cleanup. |

## Current Implementation State

1. Bulk Market Desk setup from pasted competitor lines and generic CSV is implemented.
2. Derived Market Desk Brief builder and dashboard placement are implemented.
3. Evidence-aware search answer panel is implemented.
4. Agency setup now preserves plan gates and adds customer-facing Developer access/support framing.
5. Dashboard now surfaces lifecycle retention moves from existing readiness logic.
6. Activation/retention accounting stayed within existing readiness/nudge mechanisms; no analytics provider was added.
7. Account-controls salvage review is documented in `docs/account-controls-salvage-review.md`; the referenced branch was not present locally or remotely.
8. Review-driven hardening is implemented: CSV notes/tags persist to watchlist-scoped context, client grouping links imported competitors to client rooms, selected rows that become invalid/over-cap are reported before writes, and shared plan-aware watchlist creation protects onboarding, search, dashboard, and customer-agent actions.
9. Remaining tail: autoreview, PR, deploy, post-deploy canaries, provenance, and worktree cleanup.

## Latest Verification

| Check | Result | Notes |
| --- | --- | --- |
| Focused customer-surface tests | Passed | 7 files, 58 tests |
| Commit hook `npm run typecheck` | Passed | Existing React Router/Vite warnings |
| Commit hook `npm test` | Passed | 155 files, 1461 tests |
| Commit hook `npm run build` | Passed | Existing React Router/Vite dynamic import warnings |
| Review-hardening focused tests | Passed | `tests/competitor-import.test.ts`, `tests/onboarding.route.test.ts`, `tests/search-answer.test.ts`, `tests/search.route.test.ts`, `tests/customer-agent-actions.server.test.ts`, `tests/plan-limits.route.test.ts`, `tests/market-desk-brief.test.ts` |
| Full suite after review hardening | Passed | 155 files, 1467 tests |
| `npm run typecheck` after review hardening | Passed | Existing React Router/Vite warnings |
| `npm run build` after review hardening | Passed | Existing React Router/Vite warnings and pre-existing ineffective dynamic-import warnings |
| Local authenticated E2E | Passed | 8 Playwright local-auth flows |
