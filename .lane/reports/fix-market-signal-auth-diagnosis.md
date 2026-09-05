# fix/market-signal-auth-diagnosis — lane 1 evidence

Evidence path is flattened to `.lane/reports/fix-market-signal-auth-diagnosis.md`
because `tests/lane-evidence-collision.test.ts` forbids nested directories under
`.lane/reports/` (branch names with `/` would otherwise fail CI).

## Failed dispatch

- **Run ID:** `32591392617` (workflow_dispatch on main @ `06eb090c`, 2026-08-22T18:39:45Z)
- **Conclusion:** failure in `Commit snapshot to main` (D1 generate succeeded)

## Classification (spec §3-A)

| Row | Match |
|-----|-------|
| Auth / token / secret rows | **No** — `market_signal_cloudflare_secrets_present`, wrangler D1 query succeeded, `market_signal_snapshot_fresh 2026-08-22T19:19:49.039Z` |
| **Row 4 — Unclassified** | **Yes** — commit-step `gh` failures (not wrangler auth) |

PR #813 auth fixes (`unset` shadow env, `XDG_CONFIG_HOME`, refuse-empty step) are **verified working** on this run.

## `market_signal_command_raw` (verbatim from run 32591392617)

```
market_signal_command_raw:
spawnSync gh ENOBUFS
```

(Emitted during `fetchIssues` `gh api --paginate --slurp`; snapshot continued with `github: { unavailable: true }`.)

Commit-step failure (actual job exit):

```
gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.
unknown flag: --json

Usage:  gh pr create [flags]
```

## Diff rationale

1. **`.github/workflows/market-signal-snapshot.yml`**
   - Add `GH_TOKEN: ${{ github.token }}` to `Commit snapshot to main` (self-hosted `gh` requires it; generate step already had it; origin/main omitted it, which is why `gh pr list` printed the GH_TOKEN error).
   - Drop `gh pr create --json url --jq .url` — runner `gh` does not support `--json` on `pr create`; use stdout URL instead. Per-day branch reuse, `--force-if-includes`, auto-merge, and the required-checks watch stay as-is.

2. **`scripts/market-signal-snapshot.mjs`**
   - Raise `runJson` `maxBuffer` from 4 MiB to 32 MiB to avoid `ENOBUFS` on large paginated `gh api` issue lists.

3. **`tests/market-signal-workflow.test.ts`**
   - Assert every workflow step invoking `gh` sets `GH_TOKEN`.
   - Assert commit step does not use `gh pr create --json`.

## Local test output (tail)

Targeted suite (the files this change owns):

```
 Test Files  3 passed (3)
      Tests  30 passed (30)
   Duration  1.96s
```

(files: `tests/market-signal-workflow.test.ts`, `tests/market-signal-snapshot.test.ts`, `tests/lane-evidence-collision.test.ts`)

## Addendum — continuation after #890 merged (2026-08-23 ~01:45 IST)

PR #890 merged to main as `1d3267d6` (2026-08-23 01:23:12 +0530). Verification dispatch
run `32595052170` executed EXACTLY that SHA and still failed in `Commit snapshot to main`:

```
2026-08-22T19:52:52.6693427Z pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)
2026-08-22T19:52:52.6814778Z ##[error]Process completed with exit code 1.
```

D1 generate succeeded again (commit `6a4f1451` force-pushed to
`automation/market-signal-snapshot-20260822`), but PR creation itself was denied, so no
snapshot PR exists and `ops/market-signal/0509-market-signal.json` remains absent from
main (contents API → 404 verified). The blocker has moved from code (old `gh` /
missing `GH_TOKEN` — fixed by #890, proven working: generate + branch push both green)
to a repository setting:

```
$ gh api repos/nish3451/0509/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
```

"Allow GitHub Actions to create and approve pull requests" is OFF on Nishfleet/0509.
No change inside the §2 files can grant `github-actions[bot]` `createPullRequest`, so per
spec §3-A row 4 this continuation STOPs: **no code PR opened, item NOT retired** (the next
scheduled run fails identically until the setting flips). This addendum stays uncommitted
on purpose — an evidence-only PR is forbidden for a STOP outcome.

Exact unblocking actions for Nish (either suffices):

1. Nishfleet/0509 → Settings → Actions → General → tick "Allow GitHub Actions to create
   and approve pull requests". REST equivalent (repo admin):
   `gh api -X PUT repos/Nishfleet/0509/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
   Caveat: an org-level Actions policy can also gate this (org endpoint returned 403 for
   current token scopes); check org Settings → Actions if the repo toggle alone is not enough.
2. OR wire a PAT (contents:write + pull_requests:write) as a repo/environment secret and
   use it as `GH_TOKEN` in the two `gh` steps of `.github/workflows/market-signal-snapshot.yml`.

State left behind: no queued/in-progress snapshot runs at close (nothing to adopt); no
third dispatch fired (identical failure is deterministic until unblocked); zero repo file
modifications by this continuation besides this local evidence record.

PACKET COMPLETE
