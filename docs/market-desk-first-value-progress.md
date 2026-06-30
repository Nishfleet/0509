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
| B | Bulk competitor import and normalization | Running |
| C | Search to answer engine | Read-only audit completed |
| D | Market Desk Brief and reports | Read-only audit completed |
| E | Agency and team workflows | Running |
| F | Retention, delivery, and customer delight | Running |
| G | Tests, E2E, accessibility, and red team | Running |

## Decisions

- Build Market Desk Brief as a derived server document first, not a new persistent table.
- Keep client-ready reports proof-strict; scan-backed and proof-pending items can appear in app review states, not as proven client claims.
- Add answer-led search as a pure summary layer over already-hydrated search results; do not alter provider discovery or verified-domain matching logic unless a test proves a mismatch.
- Treat MagicBrief migration as generic competitor-list import unless a real export format is supplied. The public MagicBrief shutdown guidance says analytics reports can export CSV, while other saved work may require manual recreation.
- Keep Presence smoke blocked as an owner action until `PRESENCE_INTERNAL_WORKSPACE_ID` is configured.

## Current Owner Actions

- Provide `PRESENCE_INTERNAL_WORKSPACE_ID` if the local Presence canary must be part of the final gate.
- Provide a real MagicBrief competitor export if full field parity beyond generic competitor CSV/text import is required.

## Implementation Queue

1. Bulk Market Desk setup from pasted competitor lines and generic CSV.
2. Derived Market Desk Brief builder and dashboard placement.
3. Evidence-aware search answer panel.
4. Agency setup refinements for 75-competitor workflows.
5. Developer/agent customer framing and support/billing clarity.
6. Activation/retention event accounting using existing non-sensitive audit mechanisms.
7. Focused tests, browser QA, CE review, autoreview, PR, deploy, canaries, cleanup.
