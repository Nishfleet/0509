# Launch Hardening Progress

Branch: `cursor/launch-hardening-20260623-1825`
Started: 2026-06-23

## Pre-existing work (protected, not authored by this run)

- `app/lib/better-auth.server.ts` — magic-link helpers, `appendSetCookies`, `requestHasBetterAuthSessionCookie`
- `app/lib/better-auth-magic-link-sign-in.server.ts` — sign-in completion module (new, untracked)
- `app/routes/auth.better.magic-link.tsx` — partial one-click ticket flow
- `tests/auth.server.test.ts`, `tests/auth-rebuild.test.ts` — test updates

Backup: `../pre-cursor-launch-hardening.patch`

## Baseline (before implementation)

| Check | Result | Notes |
|-------|--------|-------|
| `npm run typecheck` | PASS | |
| `npm test` | PASS (943) | |
| `npm run build` | PASS | |

## Audit item tracker

| ID | Item | Status | Commit | Evidence |
|----|------|--------|--------|----------|
| 1A | Scanner-resistant magic link | fixed | pending | GET stages ticket; POST consumes; tests in `auth.server.test.ts` |
| 1B | Unknown-account login copy | fixed | pending | `auth.login.tsx` + loader test |
| 1C | Workspace readiness UI | fixed | pending | `app.dashboard.tsx` readiness panel |
| 1D | Free-plan dead end | fixed | pending | dashboard banner + search `upgradePath` |
| 1E | Stale auth error paths | fixed | pending | removed dead error codes from login/signup |
| 2A | Atomic Dodo webhooks | pending | | |
| 2B | Empty webhook-id dedup | pending | | |
| 2C | revokeDodoPlanAccess payment id | pending | | |
| 2D | Dodo lookup indexes | pending | | |
| 2E | MCP workspace plan resolution | pending | | |
| 2F | Scheduled cancellation enforcement | pending | | |
| 2G | Razorpay hard-disable | pending | | |
| 3A | Monitoring workflow capacity | pending | | |
| 3B | Customer-visible scan status | pending | | |
| 3C | Honest monitoring | protected | | |
| 4A | Counter-move workflow | pending | | |
| 4B | Self-serve account | pending | | |
| 4C | Insight depth honesty | pending | | |
| 5A | Cloud backups | pending | | |
| 5B | Launch-readiness health | pending | | |
| 5C | Structured logging | pending | | |
| 5D | Rate-limit fail modes | pending | | |
| 5E | Email deliverability | manual/deferred | | |
| 5F | CSP / globalThis | deferred | | |
| 6A | Split data.server.ts | pending | | |
| 6B | Docs reconciliation | pending | | |
| 6C | Dead CSS/code | pending | | |
| 7 | Owner manual actions doc | pending | | |
