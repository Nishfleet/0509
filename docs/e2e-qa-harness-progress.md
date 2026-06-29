# E2E QA Harness Progress

## Baseline

- Starting main: `8c455595558ece74ad1354d1effd6a8e393270ed`
- `origin/main`: `8c455595558ece74ad1354d1effd6a8e393270ed`
- Production Worker version before work: `d28d112c-fd87-43ce-9597-24d0ca7e3b94`
- Health endpoints before work: `https://0509.io/api/health`, `https://www.0509.io/api/health`, and `https://api.0509.io/api/health` returned `200`.
- Pre-work patch: `../pre-e2e-qa-harness.patch` was empty.

## Baseline Checks

| Check | Result |
|---|---|
| `npm test` | Passed, 150 files and 1407 tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `node scripts/validate-d1-backup.mjs` | Passed, latest migration `0061_support_case_events.sql` |
| `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --local` | Local dev DB had unapplied local migrations `0053` through `0061` |
| `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote` | Passed, no remote migrations to apply |
| `git diff --check` | Passed |
| `npm run canary:pricing` | Passed for IN, US, GB |
| `npm run canary:billing` | Passed against internal canary path |
| `npm run canary:proof` | Failed before harness work with `no_digest_delivery_sent` after one email delivery attempt |
| `npm run canary:prod` | Passed health, bypass, ops readiness, and Meta ads beta |
| `npm run canary:presence` | Blocked locally by missing `PRESENCE_INTERNAL_WORKSPACE_ID` |
| Search V2 dogfood tests | Passed, 3 files and 28 tests |

## Harness Design

The harness has two separate modes:

- Local authenticated mode: seeds non-customer D1 fixture data and uses a localhost-only fixture session cookie plus an explicit E2E request header resolved inside the existing server auth boundary.
- Production authenticated smoke mode: uses owner-captured Playwright storage state from the normal magic-link login flow, plus local metadata proving the state was captured from the expected internal non-customer account and is bound to the exact storage-state file.

No production route logs users in. The E2E resolver fails closed unless explicit E2E mode is active on localhost and the fixture user id matches the `e2e-*` allowlist. Production hostnames reject the fixture path even if the E2E header and cookie are present.

## Auth-State Workflow

Owner capture:

```bash
E2E_INTERNAL_ACCOUNT_EMAIL_SHA256=<sha256-of-internal-account-email> \
npm run e2e:auth:capture
```

The browser opens to the normal Five to Nine login page. The owner signs in with the internal non-customer account. After `/app` loads, the capture script verifies the signed-in account hash without printing the email, then saves storage state to `.auth/0509-internal.json` and metadata to `.auth/0509-internal.meta.json`. The metadata includes `capturedAt` plus a SHA-256 hash of the storage-state file, so stale metadata cannot be refreshed by touching the auth file or paired with a different auth file.

Production authenticated smoke:

```bash
E2E_INTERNAL_ACCOUNT_EMAIL_SHA256=<sha256-of-internal-account-email> \
AUTH_STATE=.auth/0509-internal.json npm run e2e:prod:auth
```

The validator rejects missing, stale, malformed, non-0509, account-hash-mismatched, or metadata/state-mismatched storage state. It never prints cookies, tokens, account email, workspace IDs, or page contents.

## Tests Added

- `tests/e2e-auth.server.test.ts`
- `tests/e2e-harness-security.test.ts`
- `e2e/local-authenticated.spec.ts`
- `e2e/prod-public.spec.ts`
- `e2e/prod-authenticated.spec.ts`

## Journeys Covered

- Login/session: local fixture session and production storage-state smoke.
- Onboarding: free fixture redirects to onboarding.
- Overview: starter/scout/agency fixtures load authenticated overview.
- Search: public search page loads without auth.
- Watchlists: starter/scout fixture watchlists render.
- Presence: starter fixture website Presence renders.
- Digests/reports: starter digest renders proof-backed rows; agency report renders an agency-owned proof-backed watchlist row.
- Exports/API/MCP: source/developer page and public API docs render with Agency-only API gates.
- Notifications: source page renders delivery status and does not surface unavailable social ingestion as live.
- Billing/top-ups: starter fixture billing shows usage and purchased checks.
- Account/security: account page renders active session/account controls.
- Support: fixture support case renders.
- Mobile navigation: 320, 375, 430, 760, and 761 px widths checked for nav visibility and horizontal overflow.
- Loading/error states: missing report path shows customer-safe support error without raw stack/D1 text; free fixture is gated back to plan selection.

## Screenshot Policy

- Local and public anonymous tests may keep screenshots/traces/videos only on failure.
- Production authenticated smoke disables screenshots, traces, and videos by default.
- `.auth/`, `test-results/`, and `playwright-report/` are ignored by Git.

## Current Open Items

- Production authenticated smoke needs owner-captured `.auth/0509-internal.json` and `.auth/0509-internal.meta.json`, with `E2E_INTERNAL_ACCOUNT_EMAIL_SHA256` set.
- Local Presence canary needs `PRESENCE_INTERNAL_WORKSPACE_ID` if that canary remains required.
- In-app Codex Browser opened `https://0509.io/` and confirmed the live Five to Nine title, but the Browser DOM/screenshot calls hung in this session; Playwright supplied the detailed rendered checks.

## Final Verification

| Check | Result |
|---|---|
| `npm test` | Passed, 152 files and 1417 tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm run e2e` | Passed, 6 local authenticated tests and 1 production-safe public test |
| `npm run e2e:prod:auth` | Failed closed because `.auth/0509-internal.json` and the required account hash are missing locally |
| `node scripts/validate-d1-backup.mjs` | Passed, latest migration `0061_support_case_events.sql` |
| `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --local` | Passed, no local migrations to apply |
| `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote` | Passed, no remote migrations to apply |
| `git diff --check` | Passed |
| `npm run canary:pricing` | Passed for IN, US, GB |
| `npm run canary:billing` | Passed |
| `npm run canary:proof` | Passed on rerun; baseline `no_digest_delivery_sent` did not reproduce |
| `npm run canary:prod` | Passed health, bypass, ops readiness, and Meta ads beta |
| `npm run canary:presence` | Still blocked locally by missing `PRESENCE_INTERNAL_WORKSPACE_ID` |
| `autoreview --mode local --base origin/main` | Passed clean after accepted findings were fixed |
| `bugbot-gate status` | Recommended one paid Bugbot run because the diff touches auth/test-auth surfaces; waiting on explicit approval |

## Commands

```bash
npm run e2e:install
npm run e2e:local
npm run e2e:prod:public
E2E_INTERNAL_ACCOUNT_EMAIL_SHA256=<sha256-of-internal-account-email> \
AUTH_STATE=.auth/0509-internal.json npm run e2e:prod:auth
```
