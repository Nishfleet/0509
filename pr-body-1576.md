## Run the release-gate assertion as a required pre-merge check; auto-revert only on assertion failures (0509#1576)

9 of the last 120 merges were auto-reverted because `Deploy production` failed on main **after** merge, then re-landed (#1511 -> revert #1512 -> re-land #1518). The check existed; it ran on the wrong side of the merge.

### accept 1 — required pre-merge check `preview-assert`

New `.github/workflows/preview-assert.yml` runs the deploy job's own verification against the PR head, **invoked unchanged from deploy-production.yml**, as a required status context on main:

- `npm run typecheck` — same step, same `NODE_OPTIONS=--max-old-space-size=2048` heap budget as the deploy job.
- `npm run test` — the **full unsharded suite**, exactly as the deploy job runs it. This is the demonstrated failure class: run [33561746667](https://github.com/Nishfleet/0509/actions/runs/33561746667) failed `tests/d1-remote-restore-evidence.test.ts:222` (`AssertionError: expected false to be true`) because PR CI shards this suite across 4 jobs while the deploy job runs all 529 files together — a test that passes sharded and fails when the whole suite runs together. preview-assert runs the same unsharded command, so a pass here predicts a pass on the deploy runner.
- `npm run build` — the deploy pipeline's own build (`build/server/wrangler.json` + the `.wrangler` config redirect the production deploy uses).
- `wrangler versions upload --preview-alias <sha>` — Cloudflare's own preview mechanism (`wrangler versions upload / preview alias`, Nish 2026-09-04). A version upload is **inert**: not deployed, no traffic, never touches the worker's production bindings. **Upload-only proof — the preview URL is never requested.**

Why not the post-deploy Gate C canary (`scripts/verify-post-deploy-release.mjs`) against the preview, per the literal "same script invoked unchanged" requirement: that script hardcodes `https://0509.io`, pins the deployed production worker version, writes billing records to production D1, and sends real proof emails (`defaultBilling` / `defaultProof` / `defaultCleanup`). `wrangler versions upload` deploys a preview version of the **same production worker with the same production D1/R2/email bindings**, so running Gate C against the preview would mutate production from a PR check — which the operating model reserves for Nish. The canary stays post-merge on production exactly as today. This is not a parallel suite; it is the deploy job's own commands, run before merge.

The workflow carries no job-level `if:`/`needs:` and authorizes in-step (step 1) so it can never conclude SKIPPED — the required-context contract (`tests/required-context-no-skip.test.ts` now lists `preview-assert`).

### accept 2 — auto-revert only on classified assertion failures

`.github/workflows/auto-revert.yml` now, for a failed `Deploy production` run, classifies the failing steps via the jobs API (`$RUN_ID`) and:

- **Reverts** only when every failed step is one of the release-gate assertion steps: `Typecheck`, `Test`, `Deploy`, `Verify complete release evidence set`.
- **Files an issue instead of reverting** when any failed step is a preflight/env step — the secrets preflight (`missing+=(...)`), install, evidence materialization, canary-token sync, archiving. Reverting product code on an env fault is what produced the wrong #1512 revert.
- **Fails closed** (`halt_and_exit`) when the jobs API returns no failed step — it never falls back to reverting product code without proof of fault. No `|| true` / `2>/dev/null` swallow (gate-integrity flags that as a softened CI step).

Also fixes a real latent bug that aborted every auto-revert run at the end: `gh pr remove-label` is not a command (gh 2.93 prints `gh pr` help and exits 1), so origin/main's add-then-remove flip never completed. `gh pr edit --remove-label` is the documented form (`gh pr edit --help`).

### accept 3 — re-run proof

- Trigger class (test-step): run [33561746667](https://github.com/Nishfleet/0509/actions/runs/33561746667) — `Deploy production` failed in the **Test** step (`tests/d1-remote-restore-evidence.test.ts:222`). preview-assert runs the identical full unsharded `npm run test`, so this class is caught pre-merge. `ci-vitest-run.sh` retries only vitest pool-startup timeouts; an assertion failure (`expected false to be true`) is not retried and fails the check honestly.
- The #1511/#1518 pair: run [33485977872](https://github.com/Nishfleet/0509/actions/runs/33485977872) (#1511) failed in the **Deploy** step (`scripts/check-public-home-current.mjs --source-only` — a stale public-home source signal), then ran green as the #1512 revert and again as the #1518 re-land. Under accept 2 this run fails in an assertion-classed step (`Deploy`), so auto-revert still fires — but the stale-source-state root cause is an environment/source fault, not a product regression, and is a separate follow-up from the trigger class above. Filed as issue #1624.

**run-proof: url** `https://github.com/Nishfleet/0509/actions/runs/33561746667` (trigger: Test step, the class preview-assert catches) and `https://github.com/Nishfleet/0509/actions/runs/33485977872` (#1511 Deploy-step failure). preview-assert.yml is `pull_request`-triggered, so the new workflow's own end-to-end run is this PR's CI.

run-proof: url https://github.com/Nishfleet/0509/actions/runs/33561746667
run-proof: url https://github.com/Nishfleet/0509/actions/runs/33485977872

## Verification

Local run on this branch (all green):

```
vitest run --configLoader runner --project node tests/auto-revert-workflow.test.ts tests/preview-assert-workflow.test.ts tests/required-context-no-skip.test.ts
Test Files  3 passed (3)
Tests       23 passed (23)
exit 0
```

- YAML parse of both workflows -> valid (jobs: preview-assert; auto-revert).
- actionlint on both -> only the pre-existing `runner.environment` schema flags also present on the merged `ci.yml`/`deploy-production.yml` (house pattern); no new findings.
- sgscan --base origin/main -> No new security findings, exit 0.

**gate-owned note:** this PR edits gate-owned `.github/workflows/auto-revert.yml` (assertion-step classifier + `gh pr edit --remove-label` fix) and adds `.github/workflows/preview-assert.yml`. Per the gate-integrity contract the worker does not post the attestation; the repository admin (different identity) posts `gate-integrity-attest:` after reading the diff.

The orchestrator must add `preview-assert` to main's required status checks (branch protection). Until then the required-context contract is enforced by `tests/required-context-no-skip.test.ts`.

net-positive-because: the +471 lines are one new required-check workflow (preview-assert.yml, ~192 lines) plus its two lock-tests, replacing the failure mode of 9 auto-reverts of good production code in the last 120 merges (each the same lines of workflow plus a full revert+re-land round trip). The added machinery is test/check code plus the classifier in auto-revert.yml; no production runtime code grows.

Closes #1576
