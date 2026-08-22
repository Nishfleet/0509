# Thin rendered content on /search — already resolved by PR #563 (re-verified PR #659)

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane3-search-thin-content-already-resolved`
Base: `origin/main` at `422fbd55`

## Item

- [ ] [dogfood 694ddbd68e95] Thin rendered content on /search
  (dogfood 20260808T074205Z-msk2fl3n)

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- **PR #563** — `066f5980` "fix(search): clear dogfood 694ddbd68e95
  thin-content warning on /search and /auth/login", an ancestor of the current
  `main` HEAD (`422fbd55`). This is the primary fix: the SEO engine's
  250-word thin-content floor measured /search at 207 rendered words; the fix
  added a "What a search returns" section (proof, examples, next steps,
  honest limits) under the idle lede, and the same engine then measured
  /search at **398 rendered words with zero findings**.
- **PR #659** — `afc1e687` "fix(search): lift /search and /auth/login over
  the 250-word content floor (dogfood 69e1b4be47bf, 694ddbd68e95)" is a
  later sibling fix to the same pages/ids, also an ancestor of `main` HEAD.
- Prior evidence-only lanes already recorded the same resolution:
  `381eac1c` (2026-08-14), `befc207f` (2026-08-16), and the PR #563 conflict
  repair / lane-14 evidence records inside `066f5980` itself.

This lane re-verifies on the current tip (`422fbd55`) and records the
evidence again because the finding's own run predates the fix (dogfood
2026-08-08; fix merged 2026-08-19).

## Evidence on current main

- **Fix commit**: `066f5980` (PR #563) is merged into `origin/main` and
  covers exactly this dogfood id (`694ddbd68e95`) alongside its twin
  `69e1b4be47bf` (AI Answer Readiness on /auth/login). `afc1e687` (PR #659)
  reinforces the same pages. Both are ancestors of `422fbd55`.
- **Copy pins (route source, pre-search branch ~lines 2421–2493)**: the idle
  state keeps a quiet lede ("Nothing searched yet" / "Paste a competitor
  website and press See ads…") plus a "What a search returns" section listing
  the three result layers — "Current and recent ads", "The offer, read off
  their landing page", "The proof capture" — and a coverage/freshness caveat
  ("Coverage and freshness vary by advertiser and provider…"). The in-source
  comment names the dogfood ids and notes the copy deliberately avoids
  claiming current activity ("right now" stays gated per PR #567).
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

Live production also serves the fix: `curl https://0509.io/search` returns
the "What a search returns", "Current and recent ads" and "The proof capture"
markers (checked 2026-08-20).

## Files

- `.lane/reports/0509-lane3-search-thin-content-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
