# claim/issue-3858 — plan-integrity-query.test.ts comment: --file -> --command

## Change

`tests/plan-integrity-query.test.ts` lines 20-24: the comment claimed
`npm run billing:integrity` executes `db/queries/plan-integrity.sql` with
`wrangler d1 execute --file`. `package.json:13` actually runs it via
`wrangler d1 execute 0509 --remote --command="$(cat db/queries/plan-integrity.sql)"`.
On remote D1 `--file` uploads the file and returns execution stats
(`Total queries executed`, `Rows read`, ...), not the SELECT rows — the
verified #3848 finding. The SQL file's own header already documented the
`--command` shape; the test comment was the stale one. Comment-only, no
behavior touched.

## Verification

- `npx vitest run tests/plan-integrity-query.test.ts` — 4/4 pass (vitest 4.1.11, node project)
- `npx vitest run --configLoader runner --project node --changed origin/main` — 4/4 pass (affected-tests mode selected only this file)
- `semgrep --config p/default --baseline-commit "$(git merge-base HEAD origin/main)" --quiet --metrics=off` — clean

## Reviewer round (senior seat, GLM-5.3-Flash via pareto)

No Critical/High/Medium findings. Acted on: comment spelling tightened to
the script's verbatim `--command="$(cat ...)"`; this lane record added.
Noted: the same stale `--file` class survives in
`tests/market-signal-query.test.ts:7` while open #3848 tracks the real
workflow fix (#3857 not yet on main) — out of scope here.
