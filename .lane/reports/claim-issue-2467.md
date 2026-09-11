# #2467 resume-watchlist plan-limit check-then-act → atomic UPDATE guard

Branch: `claim/issue-2467`
Base: `origin/main` merged in at `edff3e491` (merge commit `020cc9b83`)

## What the bug was

`resume-watchlist` (and each leg of bulk resume) ran
`requireWorkspacePlanLimit` (check) then `setWatchlistActive` — a plain
`UPDATE watchlist SET is_active=?` with no count predicate (act). Two
concurrent resumes on a 3-cap scout plan both read `current=2 < 3` and both
writes landed: 4 active watchlists running usage-billed scheduled scans.

## What changed

- `app/lib/data/watchlists-core.server.ts` — `setWatchlistActive`'s resume
  direction now appends
  `AND (SELECT COUNT(*) FROM watchlist WHERE user_id=? AND is_active=1) < ?`
  to the UPDATE, bound to `getPlanLimit(await getUserPlan(env, userId),
  "watchlists")` — the same plan-limit source `checkPlanLimit` /
  `createWatchlistWithinLimit` callers use. Pause direction unchanged. No new
  parameter (per binding judge edit).
- `app/lib/watchlist-route-actions.server.ts` — a rejected resume write maps
  to `{ ok:false, error:"plan_limit_exceeded" }` with the limit message
  instead of "couldn't find"; the bulk loop treats a rejected write like a
  failed gate (`hitPlanLimit`, break).

## Same-pattern sweep (issue step 3)

- `watchlist-plan-reconcile.server.ts` upgrade-restore `SET is_active=1`:
  already atomic — caps itself via `LIMIT (SELECT MAX(0, ? - COUNT...))`.
- `api.billing.dodo.canary.ts` canary-restore `SET is_active=?`: optimistic
  CAS on exact prior state inside the billing canary, not a resume.
- `customer-agent-actions/watchlists.server.ts` `setWatchlistActiveFromAgent`:
  same check-then-act shape (`checkPlanLimit` → `setWatchlistActive`). The
  overshoot is now blocked inside `setWatchlistActive` itself; its race-loss
  error stays `watchlist_update_failed` — file is outside the judge-edited
  `files:` line, so the error-mapping change was not made.

## RED → GREEN

RED (unfixed code, `git checkout --` on the two app files):

```
× two concurrent resumes never exceed the 3-watchlist scout cap
  AssertionError: expected 4 to be 3   (countActive read 4 — race reproduced)
× a rejected resume write returns the limit message, not couldn't-find
  expected undefined to be 'plan_limit_exceeded'
× setWatchlistActive resume honours the cap inside the UPDATE itself
  expected true to be false
Test Files 1 failed | Tests 3 failed | 1 passed
```

GREEN (fix restored, then again after `git merge origin/main`):

```
Test Files 1 passed | Tests 4 passed (4)   Duration ~8-11s
```

Node project (affected-tests mode):
`npx vitest run --configLoader runner --project node --changed origin/main`
→ 334 files / 4209 tests, all passed.

Typecheck not run locally per repo AGENTS.md memory rule (CI owns it).
