---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created_at: 2026-06-29
title: E2E QA Harness For Authenticated Product Journeys
---

# E2E QA Harness For Authenticated Product Journeys

## Goal Capsule

Build a safe end-to-end QA harness for Five to Nine so Codex, Cursor, and CI can test authenticated customer journeys without live inbox access, production auth bypasses, customer accounts, or customer data.

Authority order: user-provided goal, repo `AGENTS.md`, `MEMORY.md`, current repo code, official Playwright and Better Auth source/docs.

Stop conditions: production credentials or owner-captured auth state plus the expected internal-account email hash are required for production authenticated smoke; real payments, customer notifications, customer data, Google sign-in implementation, production auth bypasses, and direct main pushes are out of scope.

## Product Contract

### Summary

The plan adds two testing modes: a local fixture-backed authenticated harness and a production smoke path that reuses owner-captured Playwright storage state from normal magic-link login after verifying it belongs to the expected internal non-customer account and matches the captured metadata.

### Requirements

- R1. Local authenticated tests must use deterministic non-customer fixtures and never require live magic-link inbox access.
- R2. Production authenticated tests must use owner-captured Playwright storage state and must not automate or weaken production login.
- R3. Captured auth state must stay local, ignored by Git, age-checked through capture metadata, matched to the expected internal-account email hash, bound to its metadata by file hash, and never printed.
- R4. Tests must cover login/session reachability, onboarding, overview, search, watchlists, Presence, digests, reports, exports/customer API docs, notifications, billing/top-ups, account/security, support, mobile navigation, loading/error states, and public routes.
- R5. Google sign-in remains a separate product decision and is not introduced as a QA workaround.
- R6. The final workflow must document what is fully verified, what is simulated, and what remains owner/manual.

### Scope Boundaries

This plan does not add a production login endpoint, production test user backdoor, Google OAuth, social connector rollout, real payment execution, real customer email sends, new migrations, or customer-data artifacts.

## Planning Contract

Key decisions:

- Local auth is resolved inside the existing server auth boundary and only when explicit E2E mode is active on localhost. This keeps production fail-closed while avoiding fragile Better Auth cookie reverse engineering.
- Local data is seeded into D1 through fixture SQL after local migrations apply. The browser sees real app routes and loaders instead of mocked pages.
- Production auth smoke relies on Playwright storage state captured by the owner through the normal login flow. The runner validates metadata `capturedAt` freshness, 0509 session structure, internal-account hash metadata, and the storage-state file hash before opening authenticated pages.
- Production-auth traces, screenshots, and videos are disabled by default because storage state and internal account screens are sensitive.

## Implementation Units

### U1. Local Test Auth Boundary

- **Goal:** Add a local-only fixture session resolver that returns the existing `AppSession` shape.
- **Files:** `app/lib/e2e-auth.server.ts`, `app/lib/auth.server.ts`, `app/lib/env.server.ts`, `tests/e2e-auth.server.test.ts`.
- **Verification:** Unit tests prove localhost-only activation, fixture-id allowlisting, app-session mapping, and production-host failure.

### U2. Playwright Harness And Fixtures

- **Goal:** Add Playwright config, fixture seeding, local authenticated journeys, production public smoke, and production auth-state smoke.
- **Files:** `playwright.config.ts`, `e2e/fixtures/e2e-local.sql`, `e2e/*.spec.ts`, `scripts/e2e-prepare-local.mjs`, `scripts/e2e-auth-capture.mjs`, `scripts/e2e-validate-auth-state.mjs`, `package.json`, `package-lock.json`, `.gitignore`.
- **Verification:** `npm run e2e:local`, `npm run e2e:prod:public`, and `E2E_INTERNAL_ACCOUNT_EMAIL_SHA256=<sha256> AUTH_STATE=.auth/0509-internal.json npm run e2e:prod:auth` when owner state exists.

### U3. Security And Workflow Docs

- **Goal:** Document the final QA workflow, Google sign-in decision, and Bugbot rules.
- **Files:** `docs/e2e-qa-harness-progress.md`, `docs/google-sign-in-decision.md`, `docs/launch-hardening-progress.md`, `.cursor/BUGBOT.md`, `tests/e2e-harness-security.test.ts`.
- **Verification:** Tests confirm auth state/artifact ignore rules and production-auth artifact controls.

## Verification Contract

| Check | Purpose |
|---|---|
| `npm test` | Existing unit/regression suite plus harness security tests |
| `npm run typecheck` | Type-level safety for route and harness changes |
| `npm run build` | Production build safety |
| `node scripts/validate-d1-backup.mjs` | D1 backup and migration replay sanity |
| `git diff --check` | Whitespace hygiene |
| `npm run e2e:local` | Local authenticated journey matrix |
| `npm run e2e:prod:public` | Anonymous production route smoke |
| `E2E_INTERNAL_ACCOUNT_EMAIL_SHA256=<sha256> AUTH_STATE=.auth/0509-internal.json npm run e2e:prod:auth` | Owner-captured production authenticated smoke |
| `npm run canary:pricing`, `npm run canary:billing`, `npm run canary:proof`, `npm run canary:prod`, `npm run canary:presence` | Existing launch canaries, with external/local blockers recorded |

## Definition of Done

Done means the harness is implemented, docs are updated, local and production-public E2E are run, production-authenticated smoke is either run with owner state or documented as owner action, security tests prove no production bypass, review gates run clean or blockers are documented, and the branch is ready for protected PR review.
