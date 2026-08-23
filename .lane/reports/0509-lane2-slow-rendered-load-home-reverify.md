# Dogfood c99ff5d9b87b: "Slow rendered load on home" — re-verified already resolved on current main

**Status: already resolved; this lane re-verifies on the current `origin/main`
tip and records fresh evidence. No product code change.**

Branch: `lane2/slow-rendered-load-home-reverify`
Base: `origin/main` at `422fbd55` (#806, 2026-08-20)

## Item

- [ ] [dogfood c99ff5d9b87b] Slow rendered load on home [dogfood
  20260808T074205Z-msk2fl3n] — "Rendered audit reached network idle in
  5136ms", page scope: home.

## Prior resolution (already in main)

- PR #542 / commit `b7078ef1` — "fix: defer pricing-preview fetch on home
  until the pricing section nears the viewport" — fixed the root cause: the
  home route eagerly fetched `/api/pricing-preview` (a Dodo checkout-preview
  call that can take seconds) on mount, keeping the rendered document from
  reaching network idle. The client fetch is now gated by an
  `IntersectionObserver` on `#pricing` (`rootMargin: "0px 0px 100% 0px"`)
  with a 10s safety-net timer that fires long after the document settles.
  The code comment pins the intent to this dogfood id: "Fetching it eagerly
  on mount kept the page's network busy after render (dogfood c99ff5d9b87b:
  rendered audit reached network idle in 5136ms)".
- Recorded previously by lane 2 of 2026-08-09 (`.lane/reports/
  0509-lane2-slow-rendered-load-home-already-resolved.md`), PR #560
  (`0508dae0`), lane 14 of 2026-08-10 (`36da1401`), and lane 5 of 2026-08-12
  (`c443c25a`) — all merged to main.

## Re-verification on this tip (2026-08-21)

- `b7078ef1` is an ancestor of current `origin/main` HEAD `422fbd55`. The
  deferred-fetch behavior is intact: `app/routes/marketing.tsx` still has no
  eager client fetch of `/api/pricing-preview`; the only client fetch sits
  inside `startPricingPreview`, gated by the `#pricing` IntersectionObserver
  plus the 10s fallback timer.
- The home document is now even stronger than at the last re-verification:
  since then PR #634 / `3b3c7bba` ("feat(marketing): publish real Dodo
  prices in SSR HTML and make the annual toggle work") moved the pricing
  preview server-side, bounded by `MARKETING_PRICING_SSR_TIMEOUT_MS = 2500`
  so a cold Dodo cache degrades to the honest checkout-localized fallback
  instead of holding the document. There is no rendering-blocking network
  dependency on the client at initial load.
- Regression suite `tests/marketing-pricing-fetch.test.tsx` passes on this
  tip: **5/5 passed** (off-screen = no fetch; one fetch when the section
  approaches the viewport; no double-fetch; SSR-published prices render
  without any client fetch; 10s fallback fires once).
- Full suite on this tip: **451 files / 5342 tests passed** — no regression
  in any home-adjacent suite (`marketing-pricing-fetch`, `root-fonts-async`,
  `siterep-widget` all green).
- Live `https://0509.io/` (2026-08-21): HTTP 200; the served HTML embeds the
  Dodo prices SSR (`€9`/`€45`/`€135`, `body data-pricing="dodo-local"`) and
  contains zero eager `/api/pricing-preview` references in the document
  load; Google Fonts stylesheet loads with `media="print"` + onload swap
  (the other render-blocking dogfood `da0f9f345221` fix), and the Site Rep
  widget install is deferred (dogfood `a08b8427701d` fix, PR #603) — both
  adjacent home-load items remain resolved.

## Verification run (this lane)

```
$ unset NODE_ENV; npx vitest run --configLoader runner tests/marketing-pricing-fetch.test.tsx
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ NODE_ENV=development npx vitest run --configLoader runner   # full suite
 Test Files  451 passed (451)
      Tests  5342 passed (5342)
```

Note: the lane worker's shell exports `NODE_ENV=production`; React 19's
`act()` is only exported from the development build, so a production
`NODE_ENV` makes every `act`-based route test fail with "act is not a
function". Unset `NODE_ENV` (or set it to `development`) before running the
suite — the repo's CI does not export it. This is an environment quirk, not
a product regression.

## Files

- `.lane/reports/0509-lane2-slow-rendered-load-home-reverify.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
