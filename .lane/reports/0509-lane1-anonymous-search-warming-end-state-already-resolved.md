# Item 89c0873277 — already resolved

Item: Give anonymous search an honest end state when the check outlives the 60s warming cap (silent stop of the promised auto-refresh).

Verdict: already resolved on origin/main by PR #612, merge commit `90cea3a50307db269c718813f446ab22d4379831`, merged 2026-08-11.

## Verification (2026-08-22, worktree `/home/nish/workspaces/agent-worktrees/0509-lane1-20260822-163031`)

### 1. Fix commit is an ancestor of fresh origin/main

```
git fetch origin main
git merge-base --is-ancestor 90cea3a50307db269c718813f446ab22d4379831 origin/main && echo IN-MAIN
```

Observed:

```
From https://github.com/Nishfleet/0509
 * branch              main       -> FETCH_HEAD
IN-MAIN
```

Pass: printed `IN-MAIN`, exit 0.

### 2. PR state is merged

```
gh pr view 612 --json state,mergeCommit
```

Observed:

```
{"mergeCommit":{"oid":"90cea3a50307db269c718813f446ab22d4379831"},"state":"MERGED"}
```

Pass: `"state": "MERGED"` and mergeCommit oid `90cea3a50307db269c718813f446ab22d4379831`.

### 3. Honest end state is present on origin/main

```
git show origin/main:app/routes/search.tsx | grep -c "warmingPollExhausted"
git show origin/main:app/routes/search.tsx | grep -c "The check is taking longer than a minute"
git show origin/main:app/routes/search.tsx | grep -c "We stopped auto-refreshing"
git show origin/main:app/routes/search.tsx | grep -c "setWarmingPollCount(0)"
```

Observed:

```
2
1
1
3
```

Pass: each count is >= 1.

### 4. Tests green at the origin/main tip

```
npx vitest run tests/search-submission-settle.test.tsx
```

Observed:

```
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.10 /home/nish/workspaces/agent-worktrees/0509-lane1-20260822-163031


 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  16:39:31
   Duration  1.82s (transform 574ms, setup 0ms, import 256ms, tests 1.06s, environment 366ms)
```

Pass: `Test Files  1 passed (1)` and `Tests  15 passed (15)`, zero failures.

No PR opened because the fix is already on main; item retired.
