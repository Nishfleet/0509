# 2026-10-05: ci-ok passed with every gate job cancelled

## What customers saw

Nothing. No change merged on the hole: the only merge to `main` in the window (#7178, edb5bb4) went through merge-queue run 37362178317 at 19:16Z with all five jobs `success`, before the first unacquired job. The risk was real, though. Two pull requests showed the one required check, `ci-ok`, green while no lint, test, secret scan or semgrep had run on them: #7179 at 956742b and #7105 at f1fb171. Neither was armed. `merge_group` runs the same `ci.yml` jobs and the same `ci-ok` step, so a queued pull request whose gate jobs found no runner would have merged untested.

A side effect of the same runner outage: the production deploy of edb5bb4 (run 37366241332) failed because its `deploy` job also found no runner, so production does not have #7178 yet.

## Start and end (UTC)

- 19:25:28 first hosted job left unacquired: `Analyze (actions)` 111942644563 (CodeQL on #7105), cancelled 19:40:30.
- 19:31:15 first CI gate job left unacquired: `Gitleaks` 111944603972 (run 37363288248). That run's `ci-ok` 111949646778 found no runner either, so it reported `cancelled` and held.
- 19:52:55 to 20:07:57 the production `deploy` job 111952012802 found no runner.
- 20:01:29 to 20:16:31 `semgrep` 111954957235 (#7103, run 37366586957) found no runner. `ci-ok` failed there, but only because `codex-node-checks` failed on its own; the unacquired `semgrep` was not what failed it.
- 20:09:13 to 20:24:14 `Gitleaks`, `codex-node-checks` and `semgrep` of run 37366376265 (#7179, 956742b) found no runner. `preview-assert` skipped at 20:24:15. `ci-ok` 111962860094 ran 20:29:30 to 20:29:33 and passed.
- 20:15:29 to 20:30:32 the same happened to run 37368606363 (#7105, f1fb171). `ci-ok` 111965065159 passed at 20:35:56.
- The hole stays open until the fix PR merges. The runner outage was still going at 20:38: agent-dispatch jobs were still queued with no runner.

## Root cause

The `ci-ok` job decided the verdict with a denylist:

```yaml
- name: Fail when a gate job failed or was cancelled
  if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
  run: exit 1
- name: Every gate job passed or skipped
  run: "true"
```

A gate job that no hosted runner picks up within 15 minutes ends with the annotation "The job was not acquired by Runner of type hosted even after multiple attempts". The checks API and the UI show it as `cancelled`. In the `needs` context it matched neither `'failure'` nor `'cancelled'`. Evidence, from job steps and check-run annotations (run attempt 1 in each case, no re-runs):

- Run 37366376265: the three gate jobs report conclusion `cancelled` with that annotation and no runner name. In `ci-ok` 111962860094, step 2 "Fail when a gate job failed or was cancelled" is `skipped` and step 3 "Every gate job passed or skipped" is `success`. Step 3 has the implicit `success()` condition and ran, so `success()` was true and the `contains(...)` half of step 2's condition was false.
- Run 37368606363: the same, `ci-ok` 111965065159 `success`.
- Control, run 37365295273: `codex-node-checks` and `semgrep` also report `cancelled`, but there the concurrency group cancelled them ("Canceling since a higher priority waiting request for ci-refs/pull/7103/merge exists"). `ci-ok` 111953144681 failed with exit code 1. So the denylist catches a concurrency cancel and misses an unacquired job, although both show the same conclusion.

Not proven: the exact string the `needs` context held for the unacquired jobs. The runner's own result type has an `Abandoned` value, which would explain it, but the step log with the evaluated expression was not read.

Not proven either: why hosted runners stopped picking up jobs from about 19:25Z. The repository is public, so it is not Actions minutes. It is not the concurrency group, which leaves a different message. Some jobs still got runners in the window (`Gitleaks` 111954956896 at 20:11, each `ci-ok` above), so the pool was degraded, not down. githubstatus.com and the organisation billing API were not reachable from the investigating session.

## How it was detected

The fleet manager saw #7179 with all three gate jobs cancelled, `preview-assert` skipped and `ci-ok` green. No alert exists for this.

## The fix

The fix PR replaces the two steps with one step that runs under `always()` and passes only when every needed job's result is exactly `success`. It prints each job's result first, so the next odd value shows in the log:

```yaml
- name: Fail unless every gate job succeeded
  if: always()
  env:
    NEEDS: ${{ toJSON(needs) }}
  run: |
    jq -r 'to_entries[] | "\(.key): \(.value.result)"' <<< "$NEEDS"
    jq -e 'all(.[]; .result == "success")' <<< "$NEEDS" > /dev/null
```

No legitimate pass is lost. `preview-assert` has no job-level `if:` (pinned by `tests/required-checks-never-skip.test.ts`), so it skips only when `codex-node-checks` did not succeed, and then `ci-ok` was already failing.

After the fix merges, #7179 and #7105 still show the old green `ci-ok` until their CI runs again. Re-run them, or leave them unarmed until a fresh run reports.

## What stops a repeat

Ranked by the correction ladder in `CLAUDE.md`.

1. Code: the allowlist step above. A result string GitHub adds later fails closed instead of passing.
2. Static analysis: a new case in `tests/required-checks-never-skip.test.ts` requires `ci-ok` to have one step, under `always()`, that checks `.result == "success"`. A return to a denylist turns that test red.
3. Rule: `AGENTS.md` "What gates a merge" now says `ci-ok` checks for `success` and never for a list of bad results.
4. Not done yet: nothing alerts when hosted jobs go unacquired. The fleet sees it only when a person looks at a pull request.
