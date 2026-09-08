# AI Answer Readiness: rendered pages lack extractable detail — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `0509-lane1-ai-answer-readiness-resolved`
Base: `origin/main` at `2b91842b` (#729)

## Item

- [ ] [dogfood 69e1b4be47bf] AI Answer Readiness: rendered pages lack
  extractable detail [dogfood 20260808T074205Z-msk2f]

## Verdict

No product code change was warranted. The item is already landed on
`origin/main` as PR **#659** (`afc1e687`, "fix(search): lift /search and
/auth/login over the 250-word content floor (dogfood 69e1b4be47bf,
694ddbd68e95)"), which is an ancestor of the current `main` HEAD (`2b91842b`).
The AI Answer Readiness engine warns when rendered pages have fewer than 250
words; before the fix, `/search` rendered 207 words and `/auth/login` 193.

## Evidence on current main

- **`app/routes/search.tsx`** — the pre-search idle state now carries honest,
  page-specific scope copy under the quiet lede: a "What a search returns"
  section (searching Meta's Ad Library across Facebook, Instagram, Audience
  Network, and Messenger) with three result layers — current and recent ads
  (creative previews with first-seen/last-active dates, filterable), the offer
  read off the landing page (hook/offer extraction + translation), and the
  proof capture (timestamped save) — plus an honest limits note (coverage and
  freshness vary, public searches rate-limited, sign in to watch). The copy
  avoids claiming current activity, keeping the "right now" promise gated
  (PR #567).
- **`app/routes/auth.login.tsx`** — the story column adds a second proof row
  (Digests, Reports, Team workspaces) and a one-time-link note, matching
  existing feature truth, lifting the rendered word count over the floor.
- **`app/app.css`** — `.f9-search-scope-list` styles the new scope list
  without a specimen or sample card, holding the BL-031 boringness budget.

## Regression pins

- `tests/search-submission-settle.test.tsx` — "idle pre-search renders honest
  scope copy clear of the thin-content heuristic": asserts the scope copy
  ("What a search returns", "Current and recent ads", "The offer, read off
  their landing page", "The proof capture", "Coverage and freshness vary by
  advertiser") and a stripped-text word count >= 250 on the idle fragment
  (a strict lower bound for what the engine sees live).
- `tests/search-language.test.tsx` — BL-031 language-contract checks on the
  idle state.
- `tests/auth-login-content-depth.test.tsx` — story-depth floor for
  `/auth/login`.

## Verification run (this lane)

Run on current main in this worktree (no product changes; evidence branch
only):

```
$ npx vitest run --configLoader runner tests/auth-login-content-depth.test.tsx tests/search-language.test.tsx
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

The settle file's full harness fails pre-existing `act is not a function`
environment errors in this runner for its render-based tests; its
content-floor assertion is present and pins the exact scope copy verified
above by direct read of the merged tree.

## Files

- `.lane/reports/0509-lane1-ai-answer-readiness-resolved.md` — this evidence
  record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
