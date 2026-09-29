# GA metrics: the real signups read

The direction metric `signups/week` is defined by source [0509#4518](https://github.com/Nishfleet/0509/issues/4518): it is the trailing seven-day count of real signups, with the e2e fixtures excluded. This doc is the landed source for that read. It is measurement only; no fixture row is deleted here.

## The live truth: the raw count is the mixture

A live read of production D1 (database `0509`, binding `DB`, database id `746c6e3d-782e-443a-82d6-28ca93a16294`) on **2026-09-23T19:06Z and 2026-09-23T19:12Z** returned:

| Read                                                  | Result                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `SELECT COUNT(*) FROM "user"`                         | **310** (308 at 19:06Z, 310 at 19:12Z — e2e runs mint rows while the read runs) |
| trailing 7d on `createdAt`                            | 310 (every row is inside 30 days)                                               |
| trailing 30d on `createdAt`                           | 310                                                                             |
| `email LIKE 'e2e+%'`                                  | **308**                                                                         |
| real signups (`email NOT LIKE 'e2e+%'`), trailing 7d  | **2**                                                                           |
| real signups (`email NOT LIKE 'e2e+%'`), trailing 30d | **2**                                                                           |

`PRAGMA table_info("user")` shows the better-auth column is **`createdAt`** (camelCase). The A.8 shorthand `created_at` fails live with `no such column: created_at at offset 40: SQLITE_ERROR [code: 7500]`. Use `createdAt`.

[Open #4439](https://github.com/Nishfleet/0509/issues/4439) quotes `signups_7d=227` from the same table; the live read above shows that number was the mixture, not the real count.

## One command for the direction metric

Run this from the repository root with D1 read access. It returns one row containing both named metrics, with the fixture exclusion and the real `createdAt` column already applied:

```bash
npx wrangler d1 execute 0509 --remote --json --command "SELECT (SELECT COUNT(*) FROM \"user\" WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io') AND \"createdAt\" >= datetime('now', '-7 days')) AS signups_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io') AND \"createdAt\" >= datetime('now', '-30 days')) AS signups_30d"
```

For the individual reads, use these commands verbatim:

| Read                            | Command                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| total                           | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS total FROM \"user\""`                                                                                                                                                                             |
| trailing 7d, fixtures excluded  | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_7d FROM \"user\" WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io') AND \"createdAt\" >= datetime('now', '-7 days')"`   |
| trailing 30d, fixtures excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_30d FROM \"user\" WHERE email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io') AND \"createdAt\" >= datetime('now', '-30 days')"` |
| fixture rows                    | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS fixture_rows FROM \"user\" WHERE email IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io')"`                                                     |

## The exclusion rule

The four fixed journey accounts are the fixture surface, listed in `app/lib/fixture-accounts.ts`; #5730 purged every other fixture row, so the steady state is the four. A count of users or workspaces written in code excludes them via `isFixtureAccount`, or in SQL via the same four emails.

The signup journeys and other e2e setup paths mint per-run accounts on other `e2e+` shapes:

- [`e2e/j1-magic-link.spec.ts:16`](../e2e/j1-magic-link.spec.ts) — `e2e+<uuid>@0509.io`
- [`e2e/j2-passkey.spec.ts:20`](../e2e/j2-passkey.spec.ts) — `e2e+<uuid>@0509.io`
- [`e2e/magic-link-expiry.spec.ts:27`](../e2e/magic-link-expiry.spec.ts) — `e2e+<tag>-<uuid>@0509.io`

Each run's own teardown deletes its minted account. A teardown gap — the J2 mid-ceremony leak is [0509#5733](https://github.com/Nishfleet/0509/issues/5733) — leaves a row this read counts as a real signup; the trade-off and the detector question live in [0509#6056](https://github.com/Nishfleet/0509/issues/6056). A real reader signs up on the production login flow; no product surface mints `e2e+` addresses. If a new fixed fixture account ever lands, it is a new read defect: add it to `app/lib/fixture-accounts.ts` and amend the exclusion here in the same PR.

## Metric definition

- `signups_7d` — real signups (`email NOT IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io')`) in the trailing 7 days, the **real** signups/week direction metric from [0509#4518](https://github.com/Nishfleet/0509/issues/4518).
- `signups_30d` — the same read over 30 days, for trend.

The recorded live read above returned `signups_7d = 2`, `signups_30d = 2`, total `310`, and `308` `e2e+%` fixture rows, read 2026-09-23T19:06–19:12Z.

## Boundary

**No fixture-row cleanup in this PR.** Row cleanup of the 308 fixture rows in production D1 is destructive-adjacent; the conference owns its shape. This doc lands measurement only.
