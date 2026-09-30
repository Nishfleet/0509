# GA metrics: the real signups read

The direction metric `signups/week` is defined by source [0509#4518](https://github.com/Nishfleet/0509/issues/4518): it is the trailing seven-day count of real signups, with the e2e fixtures and internal accounts excluded. This doc is the landed source for that read. It is measurement only; no fixture row is deleted here.

The read below is **self-detecting**: beside the filtered signup counts it returns a per-class breakdown of the table — what it excluded (`e2e+%`, `%@0509.internal`) and what it kept (`other`). The breakdown is the detector: every row the read sees lands in a declared class or in `other`, so a fixture class nobody has declared yet is visible as an `other` row to inspect instead of being silently folded into `signups_7d` ([0509#5552](https://github.com/Nishfleet/0509/issues/5552)).

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

The same table read on **2026-09-23T19:06Z and 2026-09-23T19:12Z**, before the purge, returned:

| Read | Result |
|---|---|
| `SELECT COUNT(*) FROM "user"` | **310** (308 at 19:06Z, 310 at 19:12Z — e2e runs mint rows while the read runs) |
| trailing 7d on `createdAt` | 310 (every row is inside 30 days) |
| trailing 30d on `createdAt` | 310 |
| `email LIKE 'e2e+%'` | **308** |
| real signups with the internal canary **counted**, trailing 7d | **2** |
| real signups with the internal canary **excluded**, trailing 7d | **1** |
| real signups with the internal canary **counted**, trailing 30d | **2** |
| real signups with the internal canary **excluded**, trailing 30d | **1** |

The 2026-09-23 pair is the defect this doc was amended for: the **2** is the one human signup alive then plus the `billing-canary@0509.internal` machine row, which the then-`e2e+`-only rule counted as a signup ([0509#5552](https://github.com/Nishfleet/0509/issues/5552), [0509#6002](https://github.com/Nishfleet/0509/issues/6002)). The 2026-09-29 read returns **0** — the honest number for a table with no external signup in the window.

`PRAGMA table_info("user")` shows the better-auth column is **`createdAt`** (camelCase). The A.8 shorthand `created_at` fails live with `no such column: created_at at offset 40: SQLITE_ERROR [code: 7500]`. Use `createdAt`.

[Open #4439](https://github.com/Nishfleet/0509/issues/4439) quotes `signups_7d=227` from the same table; the live reads above show that number was the mixture, not the real count.

## One command for the direction metric

Run this from the repository root with D1 read access. It returns **one row** with the two named metrics and the per-class breakdown of everything the read saw, with both exclusion shapes and the real `createdAt` column already applied:

```bash
npx wrangler d1 execute 0509 --remote --json --command "SELECT (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')) AS signups_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')) AS signups_30d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'e2e+%' AND \"createdAt\" >= datetime('now', '-7 days')) AS excluded_e2e_7d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'e2e+%' AND \"createdAt\" >= datetime('now', '-30 days')) AS excluded_e2e_30d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')) AS excluded_internal_7d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')) AS excluded_internal_30d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')) AS other_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')) AS other_30d"
```

The last two columns are the read's own blind-spot detector. `other_*` is every row matching neither declared class — real signups and any fixture shape this doc has never heard of, which is why its movement is the signal to inspect and amend. A compound `UNION ALL` of the same columns is **not** portable here: D1 answers `too many terms in compound SELECT: SQLITE_ERROR [code: 7500]`, which is why the read is one row of scalar subqueries.

For the individual reads, use these commands verbatim:

| Read | Command |
|---|---|
| total | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS total FROM \"user\""` |
| trailing 7d, excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_7d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-7 days')"` |
| trailing 30d, excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_30d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal' AND \"createdAt\" >= datetime('now', '-30 days')"` |
| fixture rows | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS fixture_rows FROM \"user\" WHERE email LIKE 'e2e+%'"` |
| internal rows | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS internal_rows FROM \"user\" WHERE email LIKE '%@0509.internal'"` |
| per-class breakdown, one read | the one command above: `signups_7d`, `signups_30d`, `excluded_e2e_*`, `excluded_internal_*`, `other_*` |

## The exclusion rule

Two email shapes are excluded, and neither is a signup. Every one of them must appear here; a class missing from this list is a read defect, not a metric:

- `e2e+%` — every e2e-minted account. The four fixed journey accounts are listed in `app/lib/fixture-accounts.ts`; a count of users or workspaces written in code excludes them via `isFixtureAccount`. The signup journeys and other e2e setup paths mint per-run accounts on other `e2e+` shapes:

  - [`e2e/j1-magic-link.spec.ts:16`](../e2e/j1-magic-link.spec.ts) — `e2e+<uuid>@0509.io`
  - [`e2e/j2-passkey.spec.ts:20`](../e2e/j2-passkey.spec.ts) — `e2e+<uuid>@0509.io`
  - [`e2e/magic-link-expiry.spec.ts:27`](../e2e/magic-link-expiry.spec.ts) — `e2e+<tag>-<uuid>@0509.io`

  Each run's own teardown deletes its minted account. A teardown gap — the J2 mid-ceremony leak is [0509#5733](https://github.com/Nishfleet/0509/issues/5733) — leaves a row in the table; five per-run `e2e+` mints were live on 2026-09-29. A leftover fixture row is not a signup either, so the SQL exclusion is the `e2e+%` prefix, not a fixed email list. The detector question for the leaks themselves lives in [0509#6056](https://github.com/Nishfleet/0509/issues/6056).
- `%@0509.internal` — internal accounts on the fleet domain. No product surface and no test surface mints them; `billing-canary@0509.internal` was created out of band and made this read report `signups_30d=2` while zero external signups existed ([0509#6002](https://github.com/Nishfleet/0509/issues/6002)). An internal canary row is not a signup. It was one row, id `billing-canary-0509`, created 2026-09-21T12:45:16Z, **no workspace row** — a machine account that exercises the billing path. The [0509#5730](https://github.com/Nishfleet/0509/issues/5730) purge removed it, so `excluded_internal_*` reads 0 today; the exclusion stays, because the canary is minted out of band and the next one lands with no PR of ours to amend this rule ([0509#5552](https://github.com/Nishfleet/0509/issues/5552)).

A real reader signs up on the production login flow; no product surface mints `e2e+` or `@0509.internal` addresses. **Amend the exclusion here in the same PR that adds the shape** — for a fixed fixture account that also means adding it to `app/lib/fixture-accounts.ts`. The two patterns to copy:

- a new e2e journey account on a `e2e+%` address — already covered by the shape rule; add it to `app/lib/fixture-accounts.ts` so the code-side count excludes it too.
- a new machine account minted outside this repo, on neither declared shape — add its `NOT LIKE '<shape>'` to the one command **and** to this rule, in the same PR that introduces it. `other_*` in the one command is what tells you it is missing.

## Metric definition

- `signups_7d` — real signups (`email NOT LIKE 'e2e+%' AND email NOT LIKE '%@0509.internal'`) in the trailing 7 days, the **real** signups/week direction metric from [0509#4518](https://github.com/Nishfleet/0509/issues/4518).
- `signups_30d` — the same read over 30 days, for trend.
- `excluded_e2e_*` / `excluded_internal_*` / `other_*` — the per-class breakdown of what the two metrics saw. Not metrics; they exist so the read can detect a class this doc has not declared.

The one command, run against production D1 (database `0509`, id `746c6e3d-782e-443a-82d6-28ca93a16294`) on **2026-09-29T17:59Z**:

| Column | Value |
|---|---|
| `signups_7d` | **0** |
| `signups_30d` | **0** |
| `excluded_e2e_7d` / `excluded_e2e_30d` | **6** / **6** |
| `excluded_internal_7d` / `excluded_internal_30d` | **0** / **0** |
| `other_7d` / `other_30d` | **0** / **0** |

The recorded live read above returned `signups_7d = 0`, `signups_30d = 0`, total `6`, `6` `e2e+%` rows and `0` `@0509.internal` rows, read 2026-09-29T17:31Z. The previously recorded read (2026-09-23, `signups_30d=2`) counted `billing-canary@0509.internal` and the operator's own account — internal rows, neither of them signups.

## Boundary

**No fixture-row cleanup in this PR.** Row cleanup in production D1 is destructive-adjacent; the conference owns its shape. This doc lands measurement only: every command here is a read, and nothing in this PR deletes, edits or writes a production row.
