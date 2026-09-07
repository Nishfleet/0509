# Thin rendered content on /search — already resolved by PR #659

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-search-thin-content-already-resolved`
Base: `origin/main` at `2b91842b`

## Item

- [ ] [dogfood 694ddbd68e95] Thin rendered content on /search
  (dogfood 20260808T074205Z-msk2fl3n)

## Verdict

No code change was warranted. The item is already landed on `origin/main` as
PR #659 — `afc1e687` "fix(search): lift /search and /auth/login over the
250-word content floor (dogfood 69e1b4be47bf, 694ddbd68e95)", an ancestor of
the current `main` HEAD (`2b91842b`). A prior lane (2026-08-10, lane 14)
already recorded the same evidence; this lane re-verified on the current tip.

## Evidence on current main

- **Fix commit**: `afc1e687` (PR #659) is merged into `origin/main` and
  covers exactly this dogfood id (`694ddbd68e95`) alongside its twin
  `69e1b4be47bf` (AI Answer Readiness on /auth/login). The dogfood finding was
  ~207 rendered words on the /search idle state — under the engine's 250-word
  thin-content floor. The route (`app/routes/search.tsx`, pre-search branch)
  now carries an honest scope section that answers the finding with
  page-specific copy — what a search returns, the proof, and the next step —
  instead of filler or decoration.
- **Copy pins (route source, lines ~2421–2493)**: the idle state keeps a quiet
  lede ("Nothing searched yet" / "Paste a competitor website and press See
  ads…") plus a "What a search returns" section listing the three result
  layers — "Current and recent ads", "The offer, read off their landing
  page", "The proof capture" — and a coverage/freshness caveat ("Coverage and
  freshness vary by advertiser and provider…"). The in-source comment names
  the dogfood ids and notes the copy deliberately avoids claiming current
  activity ("right now" stays gated per PR #567).
- **Regression pins**:
  - `tests/search-language.test.tsx` — "answers the thin-content finding with
    honest scope copy, not filler" asserts the scope section exists and the
    budgets hold (one kicker on the pre-search state, three filled buttons on
    the whole page, no specimen or sample card).
  - `tests/auth-login-content-depth.test.tsx` — "keeps the story column deep
    enough for the engine's 250-word floor" counts visible text at >= 180
    words (measured ~285 live with SSR script tokens) for the sibling page
    fixed by the same commit.
  - `tests/search-submission-settle.test.tsx` — references the same dogfood id
    at the 250-word floor (line ~296).

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/search-language.test.tsx tests/auth-login-content-depth.test.tsx
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

Note: `tests/search-submission-settle.test.tsx` fails in this environment
with `TypeError: act is not a function` (a `react`/`react-dom` act-import
environment issue in the test harness, unrelated to this item — that file
touches a different concern, search submission settling).

## Files

- `.lane/reports/0509-lane1-search-thin-content-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
