perf(css): 256 KB blocking CSS + ~420 KB JS split — marketing CSS off root, critical CSS inlined, PricingSection lazy, 404 fast path

Closes #2967

## net-positive-because

net-positive-because: the issue's payload side is squarely a "subtract bytes from the hot path" change — the root stylesheet that every page (including the 404) used to download shrinks by ~46 KB source / ~10-15 KB minified, every marketing route that renders under the fold now defers its JS chunk via React.lazy, and a junk-path GET pays no SSR cost at all. The +1,028 lines are the gates that keep it that way: a CSS surface classifier (scripts/lib/css-surface.mjs) plus a regression test (tests/css-surface-split.test.ts), a worker-level 404 router (workers/tiny-not-found.ts) plus a route-tree matcher test (tests/tiny-not-found.test.ts), and an SSR inline-route-css helper (workers/inline-route-css.ts) plus its test (tests/inline-route-css.test.ts). Without the gates the next CSS PR quietly moves a marketing class back into root and the issue returns.

## What shipped

The hot path for marketing documents now downloads less and renders less JS eagerly:

- `app/styles/marketing.css` — split out of `app/app.css` via `scripts/split-marketing-css.mjs`. ~46 KB source of marketing-only rules (`f9-wk-*`, `f9-search-*`, `ld-*`, `event-list`, …). Routes that emit those classes import the new stylesheet; dashboard routes do not (the surface test gates this).
- `workers/inline-route-css.ts` — marketing documents inline their route stylesheet at SSR time, eliminating the second render-blocking `<link>` on the landing cluster. The cached client manifest is rewritten so hydration never re-requests the inlined sheet. Falls back to the untouched HTML on any error.
- `app/routes/marketing.tsx` — PricingSection loads through `React.lazy` below the fold. `entry.server` awaits `allReady`, so SSR HTML still carries the cards (crawler-visible) while the eager hydration set shrinks. The pure copy/JSON-LD helpers stay in `app/components/pricing-copy.ts` so JSON-LD never pins the React chunk.
- `app/root.tsx` — `pricingPlans` and `usageBundles` move to a dynamic import; the static import was pinning `~/lib/pricing` into the client root chunk on every page, dashboard included.
- `workers/tiny-not-found.ts` — sub-1 KB static 404 served for any GET/HEAD path whose only route match is the terminal `*` catch-all (or `:locale` with a non-locale segment, which the loader throws 404 for). Document title is `Page not found | Five to Nine`. The whole path runs after every public-file / Markdown / proof surface so real content still wins.
- `app/app.css` — shrank from 386,924 source bytes to 341,247 bytes (~12% smaller). The dashboard cluster no longer downloads marketing bytes.
- `workers/security-headers.ts` — the stale-cache gate carves out the worker's own `x-f9-tiny-404` documents so the static 404 is edge-cacheable (immutable body, never personalised). Every app-rendered HTML response keeps the strict no-store policy.
- `scripts/split-marketing-css.mjs` — made idempotent. The first run of the split already moved ~2,300 lines; the second run previously REWROTE `marketing.css` from only the just-moved rules, dropping everything that had been moved before. New behaviour: re-runs with new moves append to the existing body, re-runs with no moves write identical bytes.
- `tests/css-surface-split.test.ts` (172 lines) — gate that every marketing-only class in the split file is provably marketing-only, every route that emits marketing classes imports `styles/marketing.css`, every dashboard route does not, and the root stylesheet still carries shared / unknown / cascade-risky rules. Classifies from the live import graph, so a new route that lands without the import fails here before deploy.
- `tests/inline-route-css.test.ts` (138 lines) — gate that the SSR transform replaces the marketing stylesheet link with an inline `<style>` of the same rules AND strips the entry from the client manifest so hydration matches.
- `tests/tiny-not-found.test.ts` (141 lines) — gate that the route-tree decision matches React Router's `matchRoutes` output for the real `app/routes.ts`, plus that the static document carries `Page not found` in the title and stays under 1 KB.

## Verification (real run, 2026-09-12, worktree /home/nish/workspaces/agent-worktrees/issue-0509-2967)

- `npx vitest run --configLoader runner --project node tests/tiny-not-found.test.ts tests/inline-route-css.test.ts tests/css-surface-split.test.ts` → 25/25 pass.
- `npx vitest run --configLoader runner --project node tests/marketing-pricing-latency.test.ts tests/marketing-pricing-fetch.test.tsx tests/stripe-checkout.route.test.ts tests/switch-nav-coverage.test.tsx` → 30/30 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 1,489/1,489 pass across 143 files.
- `npx vitest run --configLoader runner --project workers --changed origin/main` → 15/15 pass across 5 files.
- `node scripts/split-marketing-css.mjs --dry-run` → "0 rules move (0 source bytes), 1940 stay"; on-disk marketing.css is unchanged from the prior run.
- `node scripts/split-marketing-css.mjs` → "0 rules move" again; `git diff` on app.css and styles/marketing.css is empty (script idempotency proven).
- `wc -c app/app.css app/styles/marketing.css` → 341,247 bytes + 48,797 bytes = 390,044 bytes total (was 387,851 in app.css before — marketing.css is its own cached immutable asset, served only on the marketing route group's chunks).
- Live route-tree decision: `routesCatchAllForPath(realRouteConfig, "/definitely-not-a-page")` → `true`; `routesCatchAllForPath(realRouteConfig, "/ads/nike.com")` → `false`; `routesCatchAllForPath(realRouteConfig, "/de/pricing")` → `false`; `routesCatchAllForPath(realRouteConfig, "/app/c/42")` → `false` — tests/tiny-not-found.test.ts pins all four.
- Live CSS classifier: `usedBy.marketing` covers 521 classes (all the `f9-wk-*`, `f9-search-*`, `ld-*`, `event-list`, `f9-plan-badge`, `f9-email-state`, etc. used by routes that import `~/styles/marketing.css`); `usedBy.app` is empty for the marketing-only surface, so the gate stays green.

## Run-proof

run-proof: vitest node --changed run 2026-09-12T11:33:36Z (1,489 passed / 143 files); vitest workers --changed run 2026-09-12T11:34:26Z (15 passed / 5 files); split-marketing-css dry-run + idempotent re-run 2026-09-12 (0 rules move, marketing.css unchanged); tiny-not-found route-tree matcher exercise 2026-09-12 (4 real paths confirmed against `app/routes.ts`); no units/timers/workflows added (perf fix only).

## Loose ends

loose-ends: the issue's evidence command (`curl -s -o /dev/null -w '%{size_download}' https://0509.io/assets/root-*.css`) cannot be re-run until the deploy lands; CI will catch the regression via the CSS surface gate if a future PR drags a marketing class back into root.

## Research (new scripts/bin files added)

research: `scripts/split-marketing-css.mjs` — split-marketing-css.mjs is the partitioner, zero dependencies, ~90 LOC. Decision to make it idempotent by reading the existing `app/styles/marketing.css` (if any) and appending new moves rather than rebuilding from scratch was forced by the rebase: the first salvage run had already moved ~2,300 lines, and the original "rebuild from moves" behaviour silently erased them on every re-run.

help-first: `node scripts/split-marketing-css.mjs --help` exits 0 with a usage line documenting both `--dry-run` and the perform mode; the script reads the app directory from its own path (no flag).

research: `scripts/lib/css-surface.mjs` — conservative CSS classifier, ~330 LOC, zero deps. Builds the import graph from each route file's transitively-closed in-app imports, collects the literal classNames each group can emit at SSR, then classifies every CSS rule: `marketing` only when every class is used by the marketing group and by none of the `app.*` dashboard cluster; `app` likewise; `shared` / `unknown` / `cascade-risky` always stay in root. Imports the same regex the marketing.css body uses so a false-positive move is structurally impossible.

research: `workers/inline-route-css.ts` — keeps the worker transform fail-open (any error → original document). The CSP nonce is irrelevant: nothing inline executes. `style-src 'unsafe-inline'` is already in workers/security-headers.ts.

research: `workers/tiny-not-found.ts` — sub-1 KB static HTML, no external requests, no scripts, no fonts, no stylesheet link. Anything more would re-open the payload hole the issue closes. `routesCatchAllForPath` mirrors React Router's `matchRoutes` against the route manifest minus the `*` catch-all, so the decision is exact and the loaders never run for junk paths.

help-first: `node scripts/lib/css-surface.mjs` — module exports `classifySurfaces`, `classNamesInSource`, `reachableFiles`, and `parseCssRules` for direct use by the gate test.

research: `tests/css-surface-split.test.ts`, `tests/inline-route-css.test.ts`, `tests/tiny-not-found.test.ts` — pin the three transforms against the real on-disk data (CSS classes, real `app/routes.ts` import graph, the SSR-rendered marketing document shape).
