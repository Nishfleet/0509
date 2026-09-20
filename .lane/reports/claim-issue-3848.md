# Lane evidence — claim/issue-3848 (Nishfleet/0509#3848)

Goal: stop `market-signal-snapshot.yml` publishing hollow data. The workflow
ran `wrangler d1 execute 0509 --remote --file db/queries/market-signal.sql --json`;
remote `--file` returns a per-file execution summary
(`{"Total queries executed":1,"Rows read":N,...}`) in `.results`, not the
SELECT's rows, and the jq success check accepted the stats object so every
count published as `{}` / absent while `success: true`. Surfaced as an
adjacent finding in the issue-3673 lane record.

## What changed

- `.github/workflows/market-signal-snapshot.yml` — generate step now uses
  `--command="$(cat db/queries/market-signal.sql)"` (the same invocation
  `npm run billing:integrity` uses for `plan-integrity.sql`), and the jq adds
  `(.results[0]|has("users_total"))` so a stats-shaped response is a hard
  `error(...)` under `set -euo pipefail`. The `Verify snapshot freshness` step
  rejects a product section whose `users_total` is not a finite number
  (`market_signal_snapshot_hollow`) — a second, independent fail-closed layer.
- `tests/market-signal-workflow.test.ts` — pins the `--command` invocation,
  the absence of either `--file` invocation form, the jq `has()` code clause
  (not just the comment prose), and the freshness guard's own
  `Number.isFinite(...)` check + `process.exit(1)` pairing.
- `docs/ga-metrics.md`, `tests/market-signal-query.test.ts` — stale `--file`
  mentions corrected.

## Verification

- `npx vitest run --project node tests/market-signal-workflow.test.ts tests/market-signal-query.test.ts` — 18/18 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` — 18/18 pass.
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD origin/main)` — clean.
- `bash -n` on both edited run blocks — clean.
- jq simulation of the exact generate-step program: stats-shaped `.results`
  errors out (exit 5); rows-shaped emits the full product object.
- node simulation of the freshness step: hollow snapshot (stats-shaped
  `product`, fresh `generatedAt`) exits 1 with `market_signal_snapshot_hollow`;
  real snapshot exits 0.
- No live remote-D1 run from this host (no deploy credential locally); the
  `--command` returns-rows shape is the proven `billing:integrity` path, and
  the issue verified the `--file` stats shape on pinned wrangler 4.123.0.

## Review

- Reviewer round: `senior` LiteLLM group (pi reviewer subagent). Two blocking
  findings on weak test pins (prose/pre-existing exits could satisfy them)
  and advisories on the `--file=` form, guard message accuracy, the
  `Number.isFinite` pin, and this record — all addressed in the same PR.
- jev needs_review: p=0.68, advisory-only; review policy unchanged.
