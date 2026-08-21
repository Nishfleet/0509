# AI Answer Readiness: rendered pages lack extractable detail — already resolved

**Status: already resolved; this lane re-verified on current main and live, and records the evidence.**

Branch: `0509-lane5-ai-answer-readiness-verify-20260821`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] [dogfood 69e1b4be47bf] AI Answer Readiness: rendered pages lack
  extractable detail [dogfood 20260808T074205Z-msk2f]

## Verdict

No product code change was warranted. The item is already landed on
`origin/main` as PR **#659** (`afc1e687`, "fix(search): lift /search and
/auth/login over the 250-word content floor (dogfood 69e1b4be47bf,
694ddbd68e95)"), which is an ancestor of the current `main` HEAD (`422fbd55`).
The AI Answer Readiness engine warns when rendered pages have fewer than 250
words; before the fix, `/search` rendered 207 words and `/auth/login` 193.
This lane re-verified the fix on the 2026-08-21 tip of main and against the
live site, and found it intact.

## Evidence on current main (422fbd55)

- **`app/routes/search.tsx`** — the pre-search idle state carries honest,
  page-specific scope copy: a "What a search returns" section (searching
  Meta's Ad Library across Facebook, Instagram, Audience Network, and
  Messenger) with three result layers — current and recent ads (creative
  previews with first-seen/last-active dates, filterable), the offer read off
  the landing page (hook/offer extraction + translation), and the proof
  capture (timestamped save) — plus an honest limits note (coverage and
  freshness vary, public searches rate-limited, sign in to watch). The copy
  avoids claiming current activity, keeping the "right now" promise gated
  (PR #567).
- **`app/routes/auth.login.tsx`** — the story column lists Saved research,
  Watchlists, Collections, Digests, Reports, and Team workspaces, plus a
  one-time sign-in link note, matching existing feature truth.
- **`app/app.css`** — `.f9-search-scope-list` styles the scope list without a
  specimen or sample card, holding the BL-031 boringness budget.

## Live verification (2026-08-21)

- `https://0509.io/search` (HTTP 200) — SSR HTML contains the full idle
  section and the "What a search returns" scope section with all three result
  layers and the coverage note; a `WebPage` JSON-LD block is also emitted.
- `https://0509.io/auth/login` (HTTP 200) — story column with the six feature
  rows and the one-time-link note renders in SSR HTML.

## Regression pins

- `tests/search-submission-settle.test.tsx` — "idle pre-search renders honest
  scope copy clear of the thin-content heuristic": asserts the scope copy
  ("What a search returns", "Current and recent ads", "The offer, read off
  their landing page", "The proof capture", "Coverage and freshness vary by
  ...") and the >= 250 rendered-word floor.
- `tests/search-language.test.tsx` — "answers the thin-content finding with
  honest scope copy, not filler" (BL-031 contracts).
- `tests/auth-login-content-depth.test.tsx` — story depth floor.

Verification on this tip: `tests/search-language.test.tsx` (12 tests) and
`tests/auth-login-content-depth.test.tsx` (2 tests) pass.

## Note on the broader suite

`npm test` on clean main currently fails 66 tests across 21 files with
`TypeError: act is not a function` (e.g. `tests/search-submission-settle
.test.tsx`, `tests/watchlist-proof-age-hydration.test.tsx`). Diagnosis: the
installed `react@19.2.8` exposes `act` only in `react.development.js`, not in
`react.production.js`, and those tests `import { act } from "react"`, which
resolves to `undefined` under production-mode module resolution. This is a
pre-existing environment/main issue independent of this dogfood item; the
content-depth pins relevant to this item pass. It is reported here for
honesty, not fixed in this lane (out of scope).
