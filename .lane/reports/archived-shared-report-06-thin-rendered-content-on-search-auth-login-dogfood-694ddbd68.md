# Thin rendered content on /search + /auth/login — dogfood 694ddbd68e95

**Status: fixed; product code change with regression tests.**

Branch: `fix/search-thin-content`
Base: `origin/main` at `2ebd8082`
Pull request: https://github.com/nish3451/0509/pull/563

## Item

- [dogfood `694ddbd68e95`] Thin rendered content on /search — "207 rendered
  words found", page scope `/search` (`runs/20260808T074205Z-msk2fl3n.json`).
- The same backlog item's evidence also covers issue-15: "Thin rendered
  content on /auth/login — 193 rendered words found".

## Verdict

Both pages rendered below the SEO Fix Kit engine's 250-word thin-content floor
(`audit-engine.js`: `rendered.wordCount < 250`). Live reproduction on
2026-08-09 confirmed the finding is still active: `document.body.textContent`
on https://0509.io/search = 207 words, on /auth/login = 193 words (engine's
exact counting method, browser-rendered).

The fix adds honest, page-specific content — the engine's own suggested fix is
"add useful page-specific detail, proof, examples, and next steps":

- `/search` idle state: a "What a search returns" section under the quiet
  lede — what the public preview searches (Meta Ad Library, the four
  placements), what comes back (current and recent ads, the offer read off
  the landing page, the proof capture), and the honest limits + next step
  (coverage and freshness vary, rate-limited, sign in to watch). No specimen,
  no sample card, no diagram — the page's boringness budget and BL-031
  language contracts (one caps-mono kicker, three filled buttons, no dead
  classes) are preserved and locked by tests.
- `/auth/login` story column: a second proof row (Digests, Reports, Team
  workspaces) plus a one-time-link note, all matching existing feature truth
  (digest email delivery with proof, report builder, team invites, Better Auth
  magic links).

## Verification

- SEO engine rerun against the changed code (same engine the dogfood job
  wraps, `proof-seo/server/audit/engine.js`, `pageSpeed: false`), local
  dev server: `/search` rendered word count **398**, **zero findings on the
  page** — the thin-content finding no longer fires.
- `/auth/login` cannot be crawled locally (auth-route rate limiter is
  fail-closed and the local D1/remote D1 path is unavailable in this lane's
  env), so it is verified deterministically: live baseline 193 = 74 visible +
  ~119 deterministic SSR script tokens; this change adds 92 unconditional
  visible tokens → **~285 rendered words** on the deployed page (measured
  fragment test floor: 184 ≥ 180).
- Regression tests: `tests/search-submission-settle.test.tsx` (idle render
  contains the scope copy and fragment word floor ≥ 250),
  `tests/search-language.test.tsx` (source contract: new section, one kicker,
  three fills, no specimen), `tests/auth-login-content-depth.test.tsx` (new
  proof row + story depth floor 180).
- Full suite: 423 files, 4835/4835 passed; `npm run typecheck` passed;
  `git diff --check` clean.

## Files

- `app/routes/search.tsx` — idle-state scope section
- `app/routes/auth.login.tsx` — second proof row + link note
- `app/app.css` — `.f9-search-scope-list` + section-title margin rule
- `tests/search-submission-settle.test.tsx`, `tests/search-language.test.tsx`,
  `tests/auth-login-content-depth.test.tsx` (new)
