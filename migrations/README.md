# Migration numbering rules

## Prefix uniqueness

Every new migration takes the next unused 4-digit number: max existing prefix
+ 1 (`ls migrations | tail -1` is not enough — compute the max). A prefix may
never be reused.

Two files with the same prefix have an ambiguous apply order: `wrangler d1
migrations apply` orders by file name, so on a tie the order depends on a
lexicographic filename tiebreak. This was enforced by accident until the
duplicate prefix check (`node scripts/check-duplicate-migration-prefixes.mjs`,
backed by `scripts/duplicate-migration-prefix-check.lib.mjs` and enforced in
CI via `tests/duplicate-migration-prefix-check.test.ts`) started failing the
build on any pair that is not a frozen legacy duplicate.

## The three frozen legacy duplicates — never rename them

`0067`, `0087` and `0090` each have two historical files. They are recorded in
production D1's append-only migration ledger under these exact file names
(`0067_delivery_recovery_and_digest_jobs.sql` +
`0067_workspace_member_invariants.sql` verbatim in
`scripts/d1-migration-sync-check.lib.mjs`
`PRODUCTION_MIGRATION_LEDGER_BASELINE`; `0087` and `0090` landed after the
2026-07-30 baseline capture). D1's ledger is keyed by filename, so renaming an
applied file either:

- makes `wrangler d1 migrations list` report a brand-new unapplied migration,
  and a subsequent `apply` re-runs the SQL against tables/columns that already
  exist; or
- trips `migration_repository_baseline_drift` in the deploy's migration_sync
  gate and blocks every deploy.

Renumbering applies GOING FORWARD only: new files take max + 1 and never share
a prefix with anything (frozen or not).
