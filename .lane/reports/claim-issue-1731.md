# Lane report — claim/issue-1731 (D1 query budget checker, issue #1731)

## What changed

- `scripts/ci-d1-budget-check.sh` + `scripts/ci-d1-budget-check.lib.mjs`:
  applies `migrations/*.sql` to a scratch `node:sqlite` database, runs
  `EXPLAIN QUERY PLAN` over the curated hot-path list in
  `scripts/d1-budget-queries.json`, estimates daily rows read/written using
  per-table estimates in `scripts/d1-budget-estimates.json`, and fails past
  10% of the D1 free-tier daily limits (5M reads / 100K writes).
- Estimator model: `SCAN <table>` = table estimate; `SEARCH` = 1 row for
  unique-index point lookups (detected via `pragma_index_list`/`index_info`),
  else `rowsPerIndexedSearch`; sibling plan nodes multiply as nested loops;
  MULTI-INDEX OR arms count as alternatives (union, not product); table
  aliases resolved from FROM/JOIN; missing table estimate = hard error.
- `ci.yml`: new required-shape `d1-budget-check` job (in-step authorizer,
  pinned checkout, no `if:`/`needs`) plus a step before the workers-project
  (D1) vitest run in `codex-node-checks`.
- `deploy-production.yml`: `D1 query budget check` step in the `deploy` job
  before dependency install/deploy — there are no preview deployments, so
  the prod deploy gate is where the budget blocks a release.
- All 17 `scripts/*canary*.mjs` entrypoints + `meta-discovery-canary.yml`
  carry `d1-budget: reads=<n> writes=<n> runs_per_day=<n>` declarations;
  missing or over-allowance declarations fail the check.
- `docs/d1-budget-escalation-runbook.md`: Cloudflare alert email → GraphQL
  Analytics verification → throttle in `workers/schedule.ts` →
  wait-vs-upgrade decision (Nish) → incident log + estimates refresh.
- `tests/d1-budget-check.test.ts` (10 tests) and `required-context-no-skip`
  extended to cover the new required job.

## Resolved decision applied

Orchestrator `decision-resolved` 2026-09-06: bullet1=A (static estimates +
manual query list), bullet2=B (edit ci.yml; admin posts verifier-attest —
NOT self-attested), bullet3=static declarations, bullet4=B (gate
deploy-production.yml; no preview infra exists), bullet5=runbook only.

## Verification

- `bash scripts/ci-d1-budget-check.sh` → PASS, reads/day=317,700 (trip
  500,000), writes/day=8,250 (trip 10,000).
- `vitest run --project node tests/d1-budget-check.test.ts
  tests/required-context-no-skip.test.ts` → 13 passed.

## Gate-path notice

Diff touches `.github/workflows/ci.yml` and `deploy-production.yml`
(protected verifier paths under `required-verifier-integrity.yml`). The
`verifier-attest: <sha>` comment must come from the repo admin
(orchestrator path per the resolved decision); this worker must not and
did not post it.
