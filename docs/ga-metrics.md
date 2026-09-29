# GA metrics: the real signups read

The direction metric `signups/week` is defined by source [0509#4518](https://github.com/Nishfleet/0509/issues/4518): it is the trailing seven-day count of real signups, with every non-customer fixture class excluded. This doc is the landed source for that read. It is measurement only; no fixture row is deleted here.

The read below is **self-detecting**: beside the filtered signup counts it returns a per-class breakdown of the table — what it excluded (`e2e+%`, `billing-canary%`) and what it kept (`other`). The breakdown is the detector: every row the read sees lands in a declared class or in `other`, so a fixture class nobody has declared yet is visible as an `other` row to inspect instead of being silently folded into `signups_7d` ([0509#5552](https://github.com/Nishfleet/0509/issues/5552)).

## The live truth: the raw count is the mixture

A live read of production D1 (database `0509`, binding `DB`, database id `746c6e3d-782e-443a-82d6-28ca93a16294`) on **2026-09-29T17:41Z** returned:

| Read | Result |
|---|---|
| `SELECT COUNT(*) FROM "user"` | **8** (e2e runs mint and drop rows while the read runs; a read minutes earlier saw 6) |
| `email LIKE 'e2e+%'` (e2e fixture class) | **8** |
| `email LIKE 'billing-canary%'` (billing canary class) | **0** — the row was purged by [#5730](https://github.com/Nishfleet/0509/issues/5730); see the class table below |
| rows in no declared class (`other`) | **0** |
| real signups, trailing 7d | **0** |
| real signups, trailing 30d | **0** |

The same table read on **2026-09-23T19:06Z and 2026-09-23T19:12Z**, before the purge, returned:

| Read | Result |
|---|---|
| `SELECT COUNT(*) FROM "user"` | **310** (308 at 19:06Z, 310 at 19:12Z — e2e runs mint rows while the read runs) |
| trailing 7d on `createdAt` | 310 (every row is inside 30 days) |
| trailing 30d on `createdAt` | 310 |
| `email LIKE 'e2e+%'` | **308** |
| real signups with the canary **counted**, trailing 7d | **2** |
| real signups with the canary **excluded**, trailing 7d | **1** |
| real signups with the canary **counted**, trailing 30d | **2** |
| real signups with the canary **excluded**, trailing 30d | **1** |

The 2026-09-23 pair is the defect this doc was amended for: the **2** is the one human signup plus the `billing-canary-0509` machine row, which the then-`e2e+`-only rule counted as a signup ([0509#5552](https://github.com/Nishfleet/0509/issues/5552)). The 2026-09-29 read returns **0** — the honest number for a table with no external signup in the window.

`PRAGMA table_info("user")` shows the better-auth column is **`createdAt`** (camelCase). The A.8 shorthand `created_at` fails live with `no such column: created_at at offset 40: SQLITE_ERROR [code: 7500]`. Use `createdAt`.

[Open #4439](https://github.com/Nishfleet/0509/issues/4439) quotes `signups_7d=227` from the same table; the live reads above show that number was the mixture, not the real count.

## One command for the direction metric

Run this from the repository root with D1 read access. It returns **one row** with the two metrics and the per-class breakdown of everything it excluded, with the real `createdAt` column already applied:

```bash
npx wrangler d1 execute 0509 --remote --json --command "SELECT (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-7 days')) AS signups_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-30 days')) AS signups_30d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'e2e+%' AND \"createdAt\" >= datetime('now', '-7 days')) AS excluded_e2e_7d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'e2e+%' AND \"createdAt\" >= datetime('now', '-30 days')) AS excluded_e2e_30d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-7 days')) AS excluded_billing_canary_7d, (SELECT COUNT(*) FROM \"user\" WHERE email LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-30 days')) AS excluded_billing_canary_30d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-7 days')) AS other_7d, (SELECT COUNT(*) FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-30 days')) AS other_30d"
```

The last two columns are the read's own blind-spot detector. `other_*` is every row matching neither declared class — real signups and any fixture shape this doc has never heard of, which is why its movement is the signal to inspect and amend. A compound `UNION ALL` of the same columns is **not** portable here: D1 answers `too many terms in compound SELECT: SQLITE_ERROR [code: 7500]`, which is why the read is one row of scalar subqueries.

For the individual reads, use these commands verbatim:

| Read | Command |
|---|---|
| total | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS total FROM \"user\""` |
| trailing 7d, fixtures excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_7d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-7 days')"` |
| trailing 30d, fixtures excluded | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS signups_30d FROM \"user\" WHERE email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%' AND \"createdAt\" >= datetime('now', '-30 days')"` |
| per-class breakdown, one read | the one command above: `signups_7d`, `signups_30d`, `excluded_e2e_*`, `excluded_billing_canary_*`, `other_*` |
| the four journey accounts | `npx wrangler d1 execute 0509 --remote --json --command "SELECT COUNT(*) AS journey_accounts FROM \"user\" WHERE email IN ('e2e+j7@0509.io', 'e2e+j8-soft@0509.io', 'e2e+j9-mentions@0509.io', 'e2e+j12-rollovers@0509.io')"` |

## The exclusion rule

Two non-customer classes are excluded from `signups_7d` and `signups_30d`. Every one of them must appear here; a class missing from this list is a read defect, not a metric.

| Class | Predicate | Origin | Excluded since |
|---|---|---|---|
| e2e fixtures | `email LIKE 'e2e+%'` | the signup journeys and e2e setup paths in this repo; the four fixed journey accounts are listed in `app/lib/fixture-accounts.ts` and are a subset of the shape | [0509#4518](https://github.com/Nishfleet/0509/issues/4518) |
| billing canary | `email LIKE 'billing-canary%'` | minted **outside** this repo — grep `billing-canary` on `main` and the only matches are this rule: no product surface, no test, no spec mints the address. One row, id `billing-canary-0509`, created 2026-09-21T12:45:16Z, **no workspace row**. It is a machine account that exercises the billing path; it is not a signup. | [0509#5552](https://github.com/Nishfleet/0509/issues/5552) |

A count of users or workspaces written in code excludes the four journey accounts via `isFixtureAccount` in `app/lib/fixture-accounts.ts`; in SQL the metric excludes the two shapes above.

The metric excludes the `e2e+%` **shape**, not the four fixed addresses alone. The per-run accounts that e2e mints and does not always delete are `e2e+` too, so a closed address list counts them as signups while the shape rule cannot. [0509#6056](https://github.com/Nishfleet/0509/issues/6056) tracks exactly that choice, and this doc takes it: on 2026-09-29 a closed-list read returned `signups_7d = 5` on a table whose human truth was 0 — five of the five counted rows were per-run `e2e+` leaks.

The billing canary row was removed from production D1 by the [0509#5730](https://github.com/Nishfleet/0509/issues/5730) purge, so `excluded_billing_canary_*` reads 0 today. The exclusion stays: the canary is minted out of band, so the next one lands with no PR of ours to amend this rule, and the read must be right when it does.

The signup journeys and other e2e setup paths mint per-run accounts on other `e2e+` shapes:

- [`e2e/j1-magic-link.spec.ts:16`](../e2e/j1-magic-link.spec.ts) — `e2e+<uuid>@0509.io`
- [`e2e/j2-passkey.spec.ts:20`](../e2e/j2-passkey.spec.ts) — `e2e+<uuid>@0509.io`
- [`e2e/magic-link-expiry.spec.ts:27`](../e2e/magic-link-expiry.spec.ts) — `e2e+<tag>-<uuid>@0509.io`

Each run's own teardown deletes its minted account. A teardown gap — the J2 mid-ceremony leak is [0509#5733](https://github.com/Nishfleet/0509/issues/5733) — leaves a row in the `e2e+%` class, which this read excludes and reports in `excluded_e2e_*` instead of counting as a signup. A real reader signs up on the production login flow; no product surface mints `e2e+` or `billing-canary` addresses.

**Amend the exclusion here in the same PR that adds the fixture.** The known shapes to copy, in the shape the next author should add:

- a new e2e journey account on a `e2e+%` address — already covered by the shape rule; add it to `app/lib/fixture-accounts.ts` so the code-side count excludes it too.
- a new machine account minted outside this repo, on a non-`e2e+` address — add a row to the class table above **and** a `NOT LIKE '<shape>'` to the one command, in the same PR that introduces it. `other_*` in the one command is what tells you it is missing.

## Metric definition

- `signups_7d` — real signups (`email NOT LIKE 'e2e+%' AND email NOT LIKE 'billing-canary%'`) in the trailing 7 days, the **real** signups/week direction metric from [0509#4518](https://github.com/Nishfleet/0509/issues/4518).
- `signups_30d` — the same read over 30 days, for trend.
- `excluded_e2e_*` / `excluded_billing_canary_*` / `other_*` — the per-class breakdown of what the two metrics left out. Not metrics; they exist so the read can detect a class this doc has not declared.

### The recorded live read

The one command, run against production D1 (database `0509`, id `746c6e3d-782e-443a-82d6-28ca93a16294`) on **2026-09-29T17:41Z**:

| Column | Value |
|---|---|
| `signups_7d` | **0** |
| `signups_30d` | **0** |
| `excluded_e2e_7d` / `excluded_e2e_30d` | **8** / **8** |
| `excluded_billing_canary_7d` / `excluded_billing_canary_30d` | **0** / **0** |
| `other_7d` / `other_30d` | **0** / **0** |

The same table read minutes earlier returned `total = 8`, journey accounts `1`, `e2e+%` class `8`, `billing-canary%` class `0`, `other` `0`: the table is small now because [#5730](https://github.com/Nishfleet/0509/issues/5730) purged the fixture pile, and the rows that remain are e2e runs minting accounts while the read runs. The 2026-09-23 read above, on the pre-purge table, returned **2** with the canary counted and **1** with it excluded — the one human signup then alive plus the `billing-canary-0509` machine row ([0509#5552](https://github.com/Nishfleet/0509/issues/5552)). The 2026-09-29 read with both classes excluded returns **0**: no human signed up in the window, and the read says so.

## Boundary

**No fixture-row cleanup in this PR.** Row deletion is owned by [#5730](https://github.com/Nishfleet/0509/issues/5730)'s purge; this doc lands measurement only. Every command here is a read — nothing in this PR deletes, edits or writes a production row.
