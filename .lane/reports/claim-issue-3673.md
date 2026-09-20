# Lane evidence — claim/issue-3673 (Nishfleet/0509#3673)

Goal: restore the plan-integrity audit (deleted with `scripts/` in the
2026-09-19 sweep) as a discriminating three-bucket check:
payment_evidence / explained_non_customer / unexplained.

## What changed

- `db/queries/plan-integrity.sql` — the audit query. Buckets every non-free
  `user_plan` row; explained rows are `user_id = 'billing-canary-0509'` or
  `dodo_status = 'owner_grant'`. Header comment documents the `owner_grant`
  convention and the privacy contract (8-char user id prefix, email domain
  only, no writes).
- `package.json` — `billing:integrity` runs
  `wrangler d1 execute 0509 --remote --command="$(cat db/queries/plan-integrity.sql)" --json | jq -r …`.
  jq prints the report and `halt_error(1)`s on unexplained rows. `--command=`
  (not `--file`) because remote `--file` returns upload stats, not rows.
- `tests/plan-integrity-query.test.ts` — node:sqlite test applying the real
  migrations; asserts every bucket, reasons, privacy columns, free-plan
  exclusion, and pins the SQL's canary literal to `BILLING_CANARY_USER_ID`.

## Verification

- `npx vitest run --configLoader runner --project node tests/plan-integrity-query.test.ts` — 4/4 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` — 735 files / 9161 tests pass.
- `npm run billing:integrity` (remote D1, real creds) — exit 0; both live rows
  (billing-canary-0509 scout, owner 42cca12f agency owner_grant) printed under
  "explained non-customer rows" with reasons.
- Local-D1 run (migrated schema + seed with one mystery paid row) through the
  same wrangler+jq chain — exit 1, row listed under "UNEXPLAINED non-free plans".

## Adjacent finding (filed separately)

`.github/workflows/market-signal-snapshot.yml` (rewritten in ad0af2e42) uses
`wrangler d1 execute --remote --file … --json | jq`. Remote `--file` returns
execution stats, not rows — the next daily run will publish a hollow snapshot
that still passes the freshness check.
