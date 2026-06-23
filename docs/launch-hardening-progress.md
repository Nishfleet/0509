# Launch Hardening Progress

Branch: `cursor/launch-hardening-20260623-1825`
Started: 2026-06-23

## Pre-existing work (protected, not authored by this run)

- `app/lib/better-auth.server.ts` — magic-link helpers (carried forward into Phase 1 commit)
- `app/lib/better-auth-magic-link-sign-in.server.ts` — sign-in completion module
- `app/routes/auth.better.magic-link.tsx` — ticket staging flow
- `tests/auth.server.test.ts`, `tests/auth-rebuild.test.ts` — auth regression coverage

Backup: `../pre-cursor-launch-hardening.patch`

## Baseline (before implementation)

| Check | Result | Notes |
|-------|--------|-------|
| `npm run typecheck` | PASS | |
| `npm test` | PASS (943 → 945 after new tests) | |
| `npm run build` | PASS | |

## Audit item tracker

| ID | Item | Status | Commit | Evidence |
|----|------|--------|--------|----------|
| 1A | Scanner-resistant magic link | fixed | f62bb15 | GET stages ticket; POST consumes; tests in `auth.server.test.ts` |
| 1B | Unknown-account login copy | fixed | f62bb15 | `auth.login.tsx` + loader test |
| 1C | Workspace readiness UI | fixed | f62bb15 | `app.dashboard.tsx` readiness panel |
| 1D | Free-plan dead end | fixed | f62bb15 | dashboard banner + search `upgradePath` |
| 1E | Stale auth error paths | fixed | f62bb15 | removed dead error codes from login/signup |
| 2A | Atomic Dodo webhooks | fixed | f859d77 | `applyDodoPlanGrant/RevokeWithWatchlistReconcile` D1 batch |
| 2B | Empty webhook-id dedup | fixed | f859d77 | `claimDodoWebhookEvent` + route guard |
| 2C | revokeDodoPlanAccess payment id | fixed | f859d77 | no longer overwrites `dodo_payment_id` |
| 2D | Dodo lookup indexes | fixed | f859d77 | `migrations/0045_dodo_plan_lookup_indexes.sql` |
| 2E | MCP workspace plan resolution | fixed | f859d77 | `resolveWorkspaceDataUserId` in MCP + agent actions |
| 2F | Scheduled cancellation enforcement | fixed | f859d77 | `getUserPlan` + `cancellationEffectiveAt` persistence |
| 2G | Razorpay hard-disable | fixed | f859d77 | route returns 410, no plan mutations |
| 3A | Monitoring workflow capacity | deferred | | Inline 12-min budget remains; Workflow revival is infra-scale — see `docs/launch-owner-actions.md` |
| 3B | Customer-visible scan status | fixed | cb1cf44 | `recordWatchlistCapacitySkip` + watchlist run UI |
| 3C | Honest monitoring | protected | | No demo fallback introduced |
| 4A | Counter-move workflow | fixed | cb1cf44 | dashboard Mark done + `closeCounterMoveFollowUp` |
| 4B | Self-serve account | already_present | | `/app/account` exists; no Better Auth upgrade performed |
| 4C | Insight depth honesty | already_present | | existing `insight-depth` pending states preserved |
| 5A | Cloud backups | partial | cb1cf44 | `.github/workflows/d1-backup-validate.yml` + `scripts/validate-d1-backup.mjs` |
| 5B | Launch-readiness health | already_present | | `tests/launch-readiness.route.test.ts` covers token gating |
| 5C | Structured logging | fixed | cb1cf44 | `app/lib/log.server.ts` + Dodo webhook failures |
| 5D | Rate-limit fail modes | already_present | | existing `tests/rate-limit.server.test.ts` |
| 5E | Email deliverability | manual | | documented in `docs/launch-owner-actions.md` §11 |
| 5F | CSP / globalThis | deferred | | framework-wide rewrite risk — not attempted |
| 6A | Split data.server.ts | deferred | | mechanical split deferred to avoid behavioral risk in same run |
| 6B | Docs reconciliation | partial | cb1cf44 | this file + `docs/launch-owner-actions.md` |
| 6C | Dead CSS/code | not_reproduced | | `.f9-auth-gradient` not removed — not verified unused in this run |
| 7 | Owner manual actions doc | fixed | cb1cf44 | `docs/launch-owner-actions.md` |

## Final validation (this run)

| Check | Result |
|-------|--------|
| `npm test` | 945 passed |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `node scripts/validate-d1-backup.mjs` | PASS (dry-run) |
| Remote deploy / D1 apply | NOT RUN (per safety rules) |

## Rollback

Revert commits in reverse order on branch `cursor/launch-hardening-20260623-1825`:

1. Phase 3–7 commit (after landed)
2. `f859d77` — billing / MCP plan / migration `0045`
3. `f62bb15` — auth / onboarding UX

Apply migration `0045` remotely only after deploy; rollback requires no down migration (indexes are additive).
