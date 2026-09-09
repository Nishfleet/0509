## Why

Issue #2108 — generalize signup attribution beyond the six hardcoded strings. Production D1 ground truth: 15 users, 0 signups Jul-Sep, 0 real paying customers. The existing `signup_source` column (migration 0080) has a SQL `CHECK` that admits exactly five literals, so any new slug or `ref:<eTLD+1>` referer marker is rejected at write time. This PR opens the allowlist to lowercase slugs and referer-derived markers, in code and in the D1 schema, so signup attribution can grow without a migration per campaign.

This is the orchestrator re-spec (2026-09-09T16:43Z) — it overrides step 2's file list because the original `files:` scope could not meet the `accept:` criterion (the 0080 CHECK rejects any value outside the five literals; SQLite cannot ALTER a CHECK in place).

## Scope

- `migrations/0087_signup_source_open_allowlist.sql` (new) — rebuilds the `user` and `signup_source_pending` CHECK constraints (create-copy-drop-rename, so child FK references to `user` are never rewritten) so `signup_source` accepts: NULL, the five existing literals, `pricing-free`, `for_agencies`, and any value matching `length(signup_source) BETWEEN 1 AND 44 AND signup_source NOT GLOB '*[^a-z0-9:.-]*'` (lowercase slugs and `ref:<eTLD+1>`). Keeps NOT NULL on the pending table; recreates `idx_user_email_nocase` and `idx_signup_source_pending_expires`.
- `app/lib/signup-source.ts` (modified) — `allowlistedSignupSource` now also accepts lowercase slugs (`/^[a-z0-9][a-z0-9-]{0,39}$/`) and `ref:<eTLD+1>` markers (`/^ref:[a-z0-9.-]{1,40}$/`); the six existing constants keep working. `signupSourceFromRequest` falls back to `ref:<eTLD+1>` derived from the `Referer` header (coarse domain only, never the full URL or query string).
- `tests/signup-source.test.ts` (modified) — slug accepted, junk rejected, referer-derived value stored, cookie round-trip unchanged, and a shared fixture list asserted against both the code rule and the migration SQL.
- `tests/integration/signup-source.integration.test.ts` (modified) — referer-derived `ref:example.com` persisted end to end on real D1, open slug persisted, 0087 CHECK accepts/rejects the same fixture list as the code rule, and the rebuilt `user` table keeps its email index and inbound foreign keys.

## D1 expand/contract

This is a single-phase schema change (rebuild the CHECK constraints). No `DROP COLUMN`, no `DROP TABLE` of a live table (the rebuild drops the old table only after copying into the replacement), no rename of a column, no `NOT NULL` without a DEFAULT. The migration is validated by the real-D1 integration tests (the `workers` vitest project applies the full migration set to local D1).

## Verification

Real-D1 leg (workers vitest project, applies all migrations including 0087 to local D1):

```
NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --configLoader runner tests/signup-source.test.ts tests/integration/signup-source.integration.test.ts
```

→ 2 files, 23 tests passed (15 unit + 8 integration). The accept criterion is proven: a signup arriving with only `Referer: https://example.com/page` persists `ref:example.com` on `user.signup_source` (integration test "persists a referer-derived ref:<eTLD+1> marker end to end").

Type check:

```
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
```

→ exit 0.

Regression (the `user` rebuild must keep child-table writes intact):

```
NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --configLoader runner --project workers tests/integration/watch-event-writes.integration.test.ts tests/integration/saucony-watchlist.integration.test.ts tests/integration/signup-first-brief.integration.test.ts tests/integration/retention-sweep-state.integration.test.ts tests/integration/website-scan-baseline.integration.test.ts
```

→ 5 files, 32 tests passed.

run-proof: tests/signup-source.test.ts (15 tests) + tests/integration/signup-source.integration.test.ts (8 tests, real D1) + 5 regression integration files (32 tests, real D1) all green in the same vitest workers-project run; `npm run typecheck` exit 0.

net-positive-because: this is the issue's own acceptance — the open allowlist (code + D1 schema) is the load-bearing new code, and the rest is the required real-D1 integration proof plus the referer-derivation wiring. It is product work, not control-plane machinery.

## Termination note (check-d1-migrations-synced.mjs)

The issue's termination command ends with `node scripts/check-d1-migrations-synced.mjs`. That script is a **deploy-time** check (it runs in `scripts/deploy-production-plan.mjs` with `includeCloudflareCredentials: true`) that compares the local `migrations/` ledger against the **remote production D1** ledger via `wrangler d1 migrations list 0509 --remote`. It requires Cloudflare production credentials (`CLOUDFLARE_API_TOKEN` or OAuth) that do not exist on this worker VPS, and it is production-gated by repo rules. It would also report 0087 as pending (expected — the migration is applied at deploy time, not by the worker PR).

The migration is instead validated by the real-D1 integration tests, which apply the full migration set (including 0087) to local D1 and assert both the READ and WRITE paths. This matches the precedent of migration PR #1964 (0086), which also validated via real-D1 integration tests and left the production sync check to deploy time.

loose-ends: 0509#2108-check-d1-migrations-synced (deploy-time check requires Cloudflare prod credentials not present on the worker VPS; migration validated by real-D1 integration tests, production sync verified at deploy).

Closes #2108
