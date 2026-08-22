# fix/market-signal-auth-diagnosis — lane 1 evidence

## Failed dispatch

- **Run ID:** `32591392617` (workflow_dispatch on main, 2026-08-22)
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
   - Add `GH_TOKEN: ${{ github.token }}` to `Commit snapshot to main` (self-hosted `gh` requires it; generate step already had it).
   - Drop `gh pr create --json url --jq .url` — runner `gh` does not support `--json` on `pr create`; use stdout URL instead.

2. **`scripts/market-signal-snapshot.mjs`**
   - Raise `runJson` `maxBuffer` from 4 MiB to 32 MiB to avoid `ENOBUFS` on large paginated `gh api` issue lists.

3. **`tests/market-signal-workflow.test.ts`**
   - Assert every workflow step invoking `gh` sets `GH_TOKEN`.
   - Assert commit step does not use `gh pr create --json`.

## Local test output (tail)

```
 Test Files  3 passed (3)
      Tests  30 passed (30)
   Duration  419ms
```

(files: `market-signal-workflow.test.ts`, `market-signal-snapshot.test.ts`, `lane-evidence-collision.test.ts`)

PACKET COMPLETE
