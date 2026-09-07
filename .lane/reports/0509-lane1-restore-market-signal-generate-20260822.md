# Lane 1 — restore market-signal generate (item `46084cb6ec`)

## Outcome

Generate-unblock PR: https://github.com/Nishfleet/0509/pull/883 (title `fix(automation): preserve wrangler stderr on market-signal generate`). Item `46084cb6ec` is **not** retired. `ops/market-signal/0509-market-signal.json` is **not** in this diff and is still absent on `origin/main`.

## What changed

- `AUTH_FAILURE_RE` now matches only the two genuine missing-credential wrangler bodies plus the no-credentials-non-interactive body. Wrangler 4.120.0 error 9106 and missing-account-id text classify as `market_signal_snapshot_failed:`, not `market_signal_auth_required`.
- `runJson` prints `market_signal_command_raw:` (including `failure.stderr`) before throwing the classified message.
- Workflow refuses empty Cloudflare secrets before generate; generate isolates wrangler OAuth via `XDG_CONFIG_HOME` and unsets shadowing `CF_*` / `CLOUDFLARE_API_KEY` / `CLOUDFLARE_EMAIL` vars. Landing step is unchanged (not PR #813).

## Tests

```
npx vitest run tests/market-signal-snapshot.test.ts tests/market-signal-workflow.test.ts
```

Exit 0. 2 files, 26 tests green (includes the four new snapshot names and three new workflow names from spec 3.5).

## 3.6 local diagnostic

```
CLOUDFLARE_API_TOKEN unset
CLOUDFLARE_ACCOUNT_ID unset
```

`local_token=unavailable`

This worktree cannot prove GitHub `production` environment secret validity. Did not hunt for tokens in GitHub, vault, other worktrees, or `.dev.vars`. Did not run `wrangler d1 execute`.

## UNKNOWNS (do not invent answers)

1. **Live wrangler stderr for run `32544276936` is unknown.** The log only shows the canned `market_signal_auth_required` line. Secrets were present (`CLOUDFLARE_ACCOUNT_ID: ***`, `CLOUDFLARE_API_TOKEN: ***` at 2026-08-22T03:43:51Z). Possible remaining causes after this PR: invalid/empty-after-trim production token, token missing D1/Account read (wrangler 9106), or some other API error. This packet does not decide which.

2. **Stale runner OAuth is unlikely to shadow a non-empty `CLOUDFLARE_API_TOKEN` in wrangler 4.120.0** (`hasEnvCredentials()` / `getAuthFromEnv()` returns the env token first). `XDG_CONFIG_HOME` is still set so OAuth in the runner home cannot be used if env credentials are rejected as empty. Whether that isolation changes the next run is unknown until that run.

3. **This worktree cannot prove GitHub `production` environment secret validity.** `workflow_dispatch` of that job may be approval-gated and only runs when `github.ref == 'refs/heads/main'`.

4. **Whether to combine with or supersede open PR #813 is unknown until generate actually reaches `Commit snapshot to main`.** Current main landing still uses per-second branches and `--force-with-lease` (first push of a new branch can die). This PR does not mix that fix in.

5. **DONE WHEN on `origin/main` (file present, `generatedAt` < 26h) cannot be completed by this lane alone:** builders do not merge; the snapshot file must come from the scheduled/dispatch job after this generate-unblock is on main. Item `46084cb6ec` stays open.

## Acceptance

- Workflow diff vs `origin/main` contains `market_signal_missing_cloudflare_secret`, `XDG_CONFIG_HOME`, `unset CF_API_TOKEN`; does not contain `market_signal_snapshot_existing_pr` or `--force-if-includes`; `+%Y%m%dT%H%M%SZ` and `--force-with-lease` remain.
- `git diff origin/main --name-only` is the five claimed paths only.
- `git ls-tree -r origin/main --name-only | grep -F 'ops/market-signal/'` prints nothing (expected until a main-branch generate+merge succeeds).
- Did **not** run `gh workflow run market-signal-snapshot.yml`.
- Did **not** merge. Did **not** call `fleet-resolve-item`.
