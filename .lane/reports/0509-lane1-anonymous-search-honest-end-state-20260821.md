# Lane 1 — anonymous search 60s warming-cap honest end state: already resolved by PR #612 (re-verified on `422fbd55`)

**Item**: Give anonymous search an honest end state when the check outlives the 60s warming cap (silent stop of the promised auto-refresh).

**Verdict**: Already resolved on `origin/main`. PR #612 (`90cea3a5`,
"fix(search): honest end state when the anonymous check outlives the 60s
warming cap", merged 2026-08-11) is the resolving commit and an ancestor of
the current `origin/main` tip (`422fbd55`, "fix(proof): real-proof surfaces
— kill the live 'nykaa.comin' defect and raise landing-capture reliability",
2026-08-21). This lane re-verified the fix and its regression suite on this
fresh tip; no product code change was warranted.

## What the item asked for

The warming poll (5s × 12 = 60s cap) is also the auto-refresh promise. When a
background capture outlives the budget, polling stops silently but the empty
state kept saying "Usually under a minute — we'll refresh automatically" next
to a still-warming server state. The item asks for an honest end state: the
page must retract the promise, say what happened, and hand the visitor a
working retry.

## Evidence on current main (HEAD `422fbd55`)

- `git merge-base --is-ancestor 90cea3a5 422fbd55` → exit 0 (PR #612 is an
  ancestor of the current main tip).
- `git log --oneline -S "warmingPollExhausted" -- app/routes/search.tsx` →
  `90cea3a5` (PR #612) is the introducing commit; no subsequent change to
  the honest end state.
- `git log --oneline -S "SEARCH_WARMING_POLL_LIMIT" -- app/routes/search.tsx`
  → `90147b9b` (#559) introduced the poll; `90cea3a5` (#612) the honest end
  state.
- `app/routes/search.tsx` on this tip:
  - `SEARCH_WARMING_POLL_MS = 5_000` / `SEARCH_WARMING_POLL_LIMIT = 12` (the
    60s cap) at lines 145–146;
  - `warmingPollExhausted = isSearchWarming && warmingPollCount >= SEARCH_WARMING_POLL_LIMIT`
    at lines 1101–1102;
  - the honest end state renders when exhausted: "The check is taking longer
    than a minute / We stopped auto-refreshing. Retry this search to check
    again" inside an `aria-live="polite"` `role="status"` region (lines
    1894–1922), with the retry link pointing at the same URL via
    `retrySearchPath`;
  - `commandNavigationPending` releases the submit from "Searching…" with
    the same 60s budget, so the button never stays disabled behind a capture
    that never lands;
  - a navigation-commit reset (`navigationInFlightRef`) re-arms a fresh poll
    budget on a same-URL retry/re-submit, so the honest end state's retry
    actually restores the auto-refresh promise.
- `tests/search-submission-settle.test.tsx` on this tip carries the #612
  regressions, including "never leaves the submit disabled when a warming
  search does not resolve" and "shows an honest end state when the warming
  check outlives the poll budget and re-arms it on retry".

## Verification on this tip (2026-08-21)

- `NODE_ENV=development vitest run tests/search-submission-settle.test.tsx`
  → **15/15 passed** (includes both #612 warming-cap regressions).
- `NODE_ENV=development vitest run tests/search-submission-settle.test.tsx tests/search.route.test.ts tests/search-structured-data.test.ts tests/search-language.test.tsx tests/search-rebuild.test.ts`
  → **5 files / 77/77 passed** (broader /search regression surface green).
- `git diff --check` clean (no product code touched).

## History

Prior lane evidence for the same item was recorded in PR #673 (`9fcd4d85`,
2026-08-12) and re-verified by lane 2 (`0509-lane2-60s-warming-cap-honest-end-already-resolved.md`,
2026-08-15) on tip `68ec15ff`. This record re-verifies the fix on the fresh
tip `422fbd55` with rerunnable test evidence.

## Files

- `.lane/reports/0509-lane1-anonymous-search-honest-end-state-20260821.md` —
  evidence record only; no product code touched.
