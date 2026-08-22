# Thin rendered content on /search — dogfood 694ddbd68e95 (lane 14 re-run, 2026-08-10)

**Status: already fixed; PR #563 open and MERGEABLE; this lane re-verified the
fix on the current PR tip and records the evidence. No duplicate PR opened
(backlog note directs lanes not to open a second thin-content PR).**

Branch: `lane14/search-thin-content-refresh` (tracks PR branch
`fix/search-thin-content`)
Pull request: https://github.com/nish3451/0509/pull/563

## Item

- [dogfood `694ddbd68e95`] Thin rendered content on /search — "207 rendered
  words found", page scope `/search` (`runs/20260808T074205Z-msk2fl3n.json`).

## Verdict

The item's fix is already in flight as PR #563 (commit `dab25d68`,
"fix(search): clear dogfood 694ddbd68e95 thin-content warning on /search and
/auth/login"), which adds a "What a search returns" scope section to the
`/search` idle state (app/routes/search.tsx), a second proof row + one-time-link
note to `/auth/login`, `.f9-search-scope-list` styling, and regression tests.
Prior lanes recorded the original verification (same SEO engine the dogfood job
wraps: /search 398 rendered words, zero findings; login ~285 by deterministic
math) in this file's 694ddbd68e95 / 69e1b4be47bf entries.

This lane re-verified the current PR tip (commit `38115300`, after main merge
including #600's /search JSON-LD):

- `npm run typecheck`: passed.
- `npx vitest run tests/search-submission-settle.test.tsx
  tests/search-language.test.tsx tests/auth-login-content-depth.test.tsx
  tests/funnel-seo.test.ts`: 4 files, 37/37 passed.
- `gh pr view 563`: `mergeable: MERGEABLE`, `state: OPEN`; CI in progress
  (codex-node-checks/Gitleaks queued, authorize jobs pass).

## Note for future runs (test-harness gotcha)

This VPS login shell sets `NODE_ENV=production`. Under that env, `react` loads
its production build, whose top-level export has NO `act`, so tests importing
`import { act } from "react"` (a repo-wide pattern) fail with
"act is not a function". This affects clean `origin/main` equally and is not a
code regression. Run tests with `env -u NODE_ENV npx vitest run …` (as CI does;
CI passes). Verified: `env -u NODE_ENV` turns the 8 failures in
`search-submission-settle.test.tsx` into 13/13 pass.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

- [MONEY silent-failure remediation](#money-silent-failure-remediation) — PR #445, branch `fix/silent-fixmoney` (landed on `main`)
- [Silent-failure observability remediation](#silent-failure-observability-remediation) — PR #447, branch `fix/silent-fixobserve`

---
