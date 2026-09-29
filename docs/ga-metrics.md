# GA metrics: the real signups read

The direction metric `signups/week` is defined by source [0509#4518](https://github.com/Nishfleet/0509/issues/4518): it is the trailing seven-day count of real signups, with the e2e fixtures and internal accounts excluded. This doc is the landed source for that read. It is measurement only; no fixture row is deleted here.

## The live truth: the raw count is the mixture

A live read of production D1 (database `0509`, binding `DB`, database id `746c6e3d-782e-443a-82d6-28ca93a16294`) on **2026-09-29T17:31Z** returned:

| Read | Result |
|---|---|
| `SELECT COUNT(*) FROM "user"` | **6** |
| trailing 7d on `createdAt` | 6 (every row is inside 30 days) |
| trailing 30d on `createdAt` | 6 |
| `email LIKE 'e2e+%'` | **6** — one fixed journey account plus five per-run mints (`e2e+onboarded-desktop-*`, `e2e+<uuid>`) still in the table |
| `email LIKE '%@0509.internal'` | **0** — the internal-account shape; `billing-canary@0509.internal` was the row that made this read report signups that never happened |
| real signups (`email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal'`), trailing 7d | **0** |
| real signups (same exclusions), trailing 30d | **0** |

`PRAGMA table_info("user")` shows the better-auth column is **`createdAt`** (camelCase). The A.8 shorthand `created_at` fails live with `no such column: created_at at offset 40: SQLITE_ERROR [code: 7500]`. Use `createdAt`.

[Open #4439](https://github.com/Nishfleet/0509/issues/4439) quotes `signups_7d=227` from the same table; the live read above shows that number was the mixture, not the real count.

## One command for the direction metric

Run this from the repository root with D1 read access. It returns one row containing both named metrics, with both exclusion shapes and the real `createdAt` column already applied:

```bash
npx wrangler d1 execute 0509 --remote --json --command "SELECT (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')) AS signups_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')) AS signups_30d"
```

For the individual reads, use these commands verbatim:

| Read | Command |
|---|---|
| total | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS total FROM \"user\""` |
| trailing 7d, excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_7d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')"` |
| trailing 30d, excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_30d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')"` |
| fixture rows | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS fixture_rows FROM \"user\" WHERE email LIKE 'e2e+%'"` |
| internal rows | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS internal_rows FROM \"user\" WHERE email LIKE '%@0509.internal'"` |

## The exclusion rule

Two email shapes are excluded, and neither is a signup:

- `e2e+%` — every e2e-minted account. The four fixed journey accounts are listed in `app/lib/fixture-accounts.ts`; a count of users or workspaces written in code excludes them via `isFixtureAccount`. The signup journeys and other e2e setup paths mint per-run accounts on other `e2e+` shapes:

  - [`e2e/j1-magic-link.spec.ts:16`](../e2e/j1-magic-link.spec.ts) — `e2e+<uuid>@0509.io`
  - [`e2e/j2-passkey.spec.ts:20`](../e2e/j2-passkey.spec.ts) — `e2e+<uuid>@0509.io`
  - [`e2e/magic-link-expiry.spec.ts:27`](../e2e/magic-link-expiry.spec.ts) — `e2e+<tag>-<uuid>@0509.io`

  Each run's own teardown deletes its minted account. A teardown gap — the J2 mid-ceremony leak is [0509#5733](https://github.com/Nishfleet/0509/issues/5733) — leaves a row in the table; five per-run `e2e+` mints were live on 2026-09-29. A leftover fixture row is not a signup either, so the SQL exclusion is the `e2e+%` prefix, not a fixed email list. The detector question for the leaks themselves lives in [0509#6056](https://github.com/Nishfleet/0509/issues/6056).
- `%@0509.internal` — internal accounts on the fleet domain. No product surface and no test surface mints them; `billing-canary@0509.internal` was created out of band and made this read report `signups_30d=2` while zero external signups existed ([0509#6002](https://github.com/Nishfleet/0509/issues/6002)). An internal canary row is not a signup.

A real reader signs up on the production login flow; no product surface mints `e2e+` or `@0509.internal` addresses. If a new fixture or internal shape ever lands, it is a new read defect: amend the exclusion here in the same PR that adds the shape — for a fixed fixture account that also means adding it to `app/lib/fixture-accounts.ts`.

## Metric definition

- `signups_7d` — real signups (`email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal'`) in the trailing 7 days, the **real** signups/week direction metric from [0509#4518](https://github.com/Nishfleet/0509/issues/4518).
- `signups_30d` — the same read over 30 days, for trend.

The recorded live read above returned `signups_7d = 0`, `signups_30d = 0`, total `6`, `6` `e2e+%` rows and `0` `@0509.internal` rows, read 2026-09-29T17:31Z. The previously recorded read (2026-09-23, `signups_30d=2`) counted `billing-canary@0509.internal` and the operator's own account — internal rows, neither of them signups.

## Boundary

**No fixture-row cleanup in this PR.** Row cleanup in production D1 is destructive-adjacent; the conference owns its shape. This doc lands measurement only.
