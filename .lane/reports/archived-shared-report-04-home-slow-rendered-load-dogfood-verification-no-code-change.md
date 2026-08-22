# Home slow-rendered-load dogfood verification (no code change required)

**Status: already resolved by PR #542; this lane records the evidence only.**

Branch: `report/lane1-home-load-already-resolved`
Base: `origin/main` at `90147b9b`

## Item

- [dogfood `c99ff5d9b87b`] Slow rendered load on home — "Rendered audit reached
  network idle in 5136ms", page scope: home
  (`runs/20260808T074205Z-msk2fl3n.json`).

## Verdict

No code change was warranted. The root cause of the slow rendered load — the
home page eagerly fetching `/api/pricing-preview` (a Dodo checkout-preview call
that can take seconds) on mount, keeping the rendered document from reaching
network idle — was already fixed, merged, and deployed:

- PR #542 / commit `b7078ef1` (`fix/home-slow-rendered-load`), merged into
  `origin/main`, is the first content change to `app/routes/marketing.tsx` in
  the current `main` history and is an ancestor of `origin/main` HEAD
  (`90147b9b`).
- The loader returns `pricingPreview: noPricingPreview` (no server fetch), and
  the client only fetches `/api/pricing-preview` once the `#pricing` section
  approaches the viewport (with a 10s safety-net timer), so the initial
  document load settles fast. The commit message and a source comment both cite
  this exact dogfood observation (`c99ff5d9b87b: 5136ms to network idle`).
- Regression test `tests/marketing-pricing-fetch.test.tsx` locks the deferred
  behavior and passes on this branch (4/4 in `marketing-pricing-fetch`).

## Live verification (2026-08-09)

Loaded `https://0509.io/` in a real browser:

- `performance.getEntriesByType('resource')` on initial load contains NO
  `/api/pricing-preview` request — the eager fetch is gone from production.
- Rendered content confirmed (`h1`, `#pricing` section present).
- `performance.timing.domContentLoadedEventEnd - navigationStart` ≈ 1360ms,
  i.e. a healthy, fast rendered load far from the 5136ms recorded in the
  original dogfood observation. Slowest resources were the non-blocking
  favicon/apple-touch-icon and the third-party siterep widget script.

## Checks

- Focused regression `npx vitest run tests/marketing-pricing-fetch.test.tsx`: 1
  file, 4/4 passed.
- `git diff --check`: clean (markdown-only change; no product code touched).

---
