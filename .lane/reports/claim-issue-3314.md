# claim/issue-3314 — deploy blocker: restore-evidence ledger set-equality (post-rebuild close-out)

## Change

`tests/deploy-restore-evidence-gate.test.ts` (new). The fault the issue names
no longer exists to fix: the 2026-09-20 rebuild (#3679 design A) deleted the
"Generate D1 remote restore evidence" job and its whole script chain
(`verify-remote-restore-evidence.mjs`, `d1-remote-restore-evidence.mjs`,
`d1-migration-sync-check.lib.mjs`, 43 scripts total in 469f8f2eb). Restore is
D1 Time Travel; the cold copy is `d1-backup-weekly.yml` (`wrangler d1 export`
→ R2); deploy-production.yml is verify → migrate → deploy → smoke → rollback
with no ledger comparison anywhere.

The durable gap left is regression cover. The test embeds the exact two ledger
lists printed by run 34705843153 (112 backup / 97 repo names), proves their
only asymmetry is 16 historical backup-only + 1 repo-only name — i.e. why name
set-equality could never pass — and fails the build if any workflow step reads
an applied/backup migration ledger (`d1 migrations list`, `d1_migrations`, the
sync-check tokens, the deleted script chain). `wrangler d1 migrations apply`
is the deploy step, not a ledger read, and is deliberately not matched.

## Verification

- `npx vitest run tests/deploy-restore-evidence-gate.test.ts` — 5/5 pass (vitest 4.1.11, node project)
- fails-before: same run with `.github/workflows/deploy-production.yml` swapped for the pre-rebuild file at run 34705843153's head (fc28cd44e) → 3/5 red, flagging all 5 evidence-machinery steps; restored → 5/5 green
- `npx vitest run --configLoader runner --project node --changed origin/main` — 5/5 (affected mode selected only this file)
- `semgrep --config p/default --baseline-commit "$(git merge-base HEAD origin/main)" --quiet --metrics=off` — clean
- termination: `gh run list -R Nishfleet/0509 --workflow 'Deploy production' --branch main --limit 1` → success (35531893039 @ d4bd9fe1, 2026-09-20T19:18:53Z); last 5 runs all green
- live: `curl -s https://0509.io/api/health/deep` → `{"status":"ok", checks all ok}` 2026-09-21T01:12Z. The rebuilt /status page renders no commit sha — the literal "version newer than 3b3de23d" bullet has no surface post-rebuild; the deployed tree postdates the issue's baseline by the whole rebuild. Follow-up filed as #3868.

## Reviewer round (senior seat, GLM-5.3-Flash via pareto — pi `reviewer` subagent)

No Critical/High findings; merge-ready verdict. The reviewer independently
re-derived the fixture against the real run log (multiset-identical, 112/97)
and reproduced the fails-before swap (3/5 red on the fc28cd44e workflow).

Acted on:
- tripwire regex widened: `migration[\s_-]?ledgers?` + `list[-\s]migrations`
  added (space-separated and reversed phrasings no longer escape)
- scan surface widened from step name+run to each job's full serialized
  surface (`JSON.stringify` of the parsed job) — env/with/uses/composite
  carriers are covered; YAML comments are dropped by `parse` so prose cannot
  false-positive
- filed #3868: the /status version bullet needs a real surface post-rebuild

Noted: the fixture embeds the full 112/97-name lists verbatim rather than only
the diff — deliberate, the acceptance names "the exact two ledger lists".
