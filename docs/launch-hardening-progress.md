# Launch Hardening Progress

Branch: `cursor/launch-hardening-20260623-1825`
Started: 2026-06-23

## Pre-existing work (protected, not authored by this run)

- `app/lib/better-auth.server.ts` — magic-link helpers (carried forward into Phase 1 commit)
- `app/lib/better-auth-magic-link-sign-in.server.ts` — sign-in completion module
- `app/routes/auth.better.magic-link.tsx` — ticket staging flow
- `tests/auth.server.test.ts`, `tests/auth-rebuild.test.ts` — auth regression coverage

Backup: `../pre-cursor-launch-hardening.patch` (pre-run) · `../pre-final-hardening.patch` (pre-merge correction pass)

## Baseline (merge base `ceb86c8` / `origin/main`)

| Check | Result | Notes |
|-------|--------|-------|
| `npm run typecheck` | PASS | |
| `npm test` | PASS (942 tests) | Independently measured on merge base |
| `npm run build` | PASS | |

## Audit item tracker

| ID | Item | Status | Commit | Evidence |
|----|------|--------|--------|----------|
| 1A | Scanner-resistant magic link | fixed | f62bb15 | GET stages ticket; POST consumes; tests in `auth.server.test.ts` |
| 1B | Unknown-account login copy | fixed | f62bb15 | `auth.login.tsx` + loader test |
| 1C | Workspace readiness UI | fixed | f62bb15 | `app.dashboard.tsx` readiness panel |
| 1D | Free-plan dead end | fixed | f62bb15 | dashboard banner + search `upgradePath` |
| 1E | Stale auth error paths | fixed | f62bb15 | removed dead error codes from login/signup |
| 2A | Atomic Dodo webhooks | fixed | f859d77 + final pass | `db.batch()` for plan/watchlist/credit mutations + ledger `processed` |
| 2A′ | Recoverable Dodo ledger | fixed | final pass | `beginDodoWebhookEventProcessing` lease + `failed` retry path (`0046`) |
| 2A″ | Refund revocation atomic | fixed | final pass | `applyDodoRefundWithWatchlistReconcile` single batch |
| 2A‴ | Pre-batch watchlist count race | fixed | final pass | reactivate/deactivate via SQL subqueries inside batch |
| 2B | Empty webhook-id dedup | fixed | f859d77 + final pass | route 400 + no claim on blank/missing id |
| 2C | revokeDodoPlanAccess payment id | fixed | f859d77 | no longer overwrites `dodo_payment_id` |
| 2D | Dodo lookup indexes | fixed | f859d77 | `migrations/0045_dodo_plan_lookup_indexes.sql` |
| 2E | MCP workspace plan resolution | fixed | f859d77 | `resolveWorkspaceDataUserId` in MCP + agent actions |
| 2F | Scheduled cancellation enforcement | fixed | f859d77 | `getUserPlan` + `cancellationEffectiveAt` persistence |
| 2G | Razorpay hard-disable | fixed | f859d77 | route returns 410, no plan mutations |
| 3A | Monitoring workflow capacity | deferred | | Agency **75** watchlist allowance vs ~12 min inline budget — **unresolved** |
| 3B | Customer-visible scan status | fixed | cb1cf44 + final pass | capacity skip label “Delayed — capacity limit” |
| 3B′ | Capacity-skip idempotency | fixed | final pass | `watchlist_run.idempotency_key` + `INSERT OR IGNORE` (`0046`) |
| 3C | Honest monitoring | protected | | No demo fallback introduced |
| 4A | Counter-move workflow | fixed | cb1cf44 + final pass | dashboard Mark done + route/action tests |
| 4B | Self-serve account | already_present | | `/app/account` exists |
| 4C | Insight depth honesty | already_present | | existing `insight-depth` pending states preserved |
| 5A | Cloud backups | partial | cb1cf44 | CI validation only — **not** activated cloud backup |
| 5B | Launch-readiness health | already_present | | `tests/launch-readiness.route.test.ts` |
| 5C | Structured logging | fixed | cb1cf44 | `app/lib/log.server.ts` |
| 5D | Rate-limit fail modes | already_present | | `tests/rate-limit.server.test.ts` |
| 5E | Email deliverability | manual | | `docs/launch-owner-actions.md` §11 |
| 5F | CSP / globalThis | deferred | | not attempted |
| 6A | Split data.server.ts | deferred | | not attempted |
| 6B | Docs reconciliation | fixed | final pass | this file + `docs/launch-owner-actions.md` |
| 6C | Dead CSS/code | not_reproduced | | |
| 7 | Owner manual actions doc | fixed | cb1cf44 | `docs/launch-owner-actions.md` |

## Dodo billing runtime (final pass)

**Claim (separate step):** `beginDodoWebhookEventProcessing` inserts or updates `dodo_webhook_event` to `outcome = processing` with `processing_started_at`. Already-`processed` events return duplicate success. Fresh concurrent `processing` returns in-progress duplicate. Stale `received`/`processing` rows older than **5 minutes** (`DODO_WEBHOOK_PROCESSING_LEASE_MS`) can be reclaimed. `failed` rows are retryable. Signature verification still runs before claim.

**Application (atomic batch):** Each supported event calls one `db.batch()` that includes all business mutations (plan grant/revoke, watchlist reconcile, proof credits, refund revocation) **and** the final `UPDATE dodo_webhook_event SET outcome = 'processed' WHERE outcome = 'processing'`. Partial failure rolls back the whole batch. On thrown errors after claim, `failDodoWebhookEventProcessing` marks `failed` so redelivery can retry.

**Not in the batch:** webhook signature verification, event claim/lease, pre-refund payment lookup (`getUserIdForDodoPayment`), and `failDodoWebhookEventProcessing`.

## Final validation (2026-06-23 pre-merge correction pass)

| Check | Result |
|-------|--------|
| `npm test` | **967 passed** (109 files) — `npm test` on 2026-06-23 |
| `npm run typecheck` | PASS (first run, includes `cf-typegen` + `react-router typegen`) |
| `npm run build` | PASS |
| `node scripts/validate-d1-backup.mjs` | PASS (dry-run only) |
| `wrangler d1 migrations list 0509 --local` | `0045` + `0046` present locally |
| Remote deploy / remote D1 apply | **NOT RUN** |

New local migration: `0046_dodo_ledger_lease_and_capacity_skip_idempotency.sql` — `processing_started_at` on `dodo_webhook_event`; `idempotency_key` + partial unique index on `watchlist_run`.

## Remaining limitations

- **Agency nightly capacity:** inline cron still caps at roughly 15–40 watchlists per run; Agency allows 75. Workflow fan-out not revived.
- **CSP / globalThis / data.server split:** deferred.
- **Cloud D1 backup:** CI validates scripts only; production schedule not activated.
- **Claim vs application:** not a single D1 transaction end-to-end; lease-based claim is recoverable and tested.

## Rollback

Revert commits in reverse order on branch `cursor/launch-hardening-20260623-1825`:

1. Final docs commit (pre-merge correction pass)
2. Final test commit
3. Final monitoring commit
4. Final billing commit
5. `5f3e320` — progress doc (original)
6. `cb1cf44` — monitoring visibility / counter-move / ops
7. `f859d77` — billing / MCP / migration `0045`
8. `f62bb15` — auth / onboarding UX

Apply migrations `0045` and `0046` remotely only after deploy. Rollback requires no down migrations (both additive).
