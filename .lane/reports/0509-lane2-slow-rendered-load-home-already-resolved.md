# Dogfood c99ff5d9b87b: "Slow rendered load on home" — already resolved by PR #542

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane2-slow-rendered-load-home-already-resolved`
Base: `origin/main` at `2b91842b` (#729)

## Item

- [ ] [dogfood c99ff5d9b87b] Slow rendered load on home [dogfood 20260808T074205Z-msk2fl3n]

## Verdict

No code change is warranted. The root cause — the home route eagerly fetching
`/api/pricing-preview` on mount, keeping the page's network busy for seconds
after render (rendered audit reached network idle in 5136ms) — is already
fixed on `origin/main` by PR #542 (`b7078ef1`, "fix: defer pricing-preview
fetch on home until the pricing section nears the viewport", merged
2026-08-08). A prior lane (2026-08-09) already recorded the same evidence;
this lane re-verified on the current tip.

## Evidence on current main

- **Root cause fix**: `app/routes/marketing.tsx` no longer fetches the Dodo
  checkout-preview on mount. The pricing preview is fetched only when the
  `#pricing` section approaches the viewport
  (`IntersectionObserver`, `rootMargin: "0px 0px 100% 0px"`), with a 10s
  safety-net timer for non-scrolling viewers that fires long after the
  document has settled. The comment in the code pins the intent to this
  dogfood item: "Fetching it eagerly on mount kept the page's network busy
  after render (dogfood c99ff5d9b87b: rendered audit reached network idle in
  5136ms)."
- **Commit**: `b7078ef1` "fix: defer pricing-preview fetch on home until the
  pricing section nears the viewport (#542)" is an ancestor of current `main`
  (`git log --oneline app/routes/marketing.tsx` shows it in the file's
  history; `2b91842b` HEAD contains it).
- **Regression pins**: `tests/marketing-pricing-fetch.test.tsx` (4 tests,
  added by PR #542) pins the exact behavior:
  - "does not fetch the pricing preview while the pricing section is
    off-screen" — no `fetch` call on mount.
  - "fetches the pricing preview once when the pricing section approaches
    the viewport".
  - "renders the fetched prices into the plan cards after the section
    becomes visible".
  - "falls back to fetching the preview after the page has long settled"
    (10s fallback timer).
- **Live check (prior lane, 2026-08-09)**: `https://0509.io` shows no
  `/api/pricing-preview` on initial load; DOMContentLoaded ~1360ms.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/marketing-pricing-fetch.test.tsx
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Note: the worktree must be run without `NODE_ENV=production` in the
environment; React 19's `act()` is only exported from the development build,
so a production NODE_ENV makes all `act`-based route tests fail with
"act is not a function" (63 tests / 20 files). With `NODE_ENV` unset, the
full suite is green (415 passed / 435 files in the worktree run).

## Files

- `.lane/reports/0509-lane2-slow-rendered-load-home-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
