# Lane evidence — claim/issue-3098 (Nishfleet/0509#3098)

## Task

/guides/* how-to pages stamped the site-wide generic `/og-image.png` while
/ads/:domain, /timeline/:domain, and the cluster surfaces already serve
page-specific rasterized cards. Fix must be route-generic so the new guides
from #3093 inherit it without per-page code.

## Approach

Auto-derivation in `publicSeoMeta`: when `pathname` matches `/guides/<slug>`
and no explicit `ogImageUrl` is passed, the meta stamps
`/social-card/guides/<slug>.png?n=<page title minus " | Five to Nine">`.
Every current guide route (and any future one) gets a page-specific card
through the same `publicSeoMeta` call it already makes — zero per-page wiring.

## Changes

- `app/lib/seo.ts` — `guideSocialCardUrl(slug, headline)` builder plus
  `guideSocialCardForPathname` auto-derivation inside `publicSeoMeta`
  (explicit `ogImageUrl`/`ogImageAlt` still wins).
- `app/lib/social-cards.server.ts` — new `guide` card kind:
  `/social-card/guides/<slug>.png` (`.svg` alias serves PNG), headline from
  the `n` query param with a humanized-slug fallback, subline
  "How-to guide · Five to Nine", 24h cache (static page copy, not live data).
- `workers/app.ts` — `guide` added to the PNG rasterization branch.
- `tests/social-cards.test.ts` — builder/parse/render cases, the
  auto-derivation and override precedence, the `/guides` index staying on the
  generic card, and a `readdirSync` sweep asserting every `guides.*.<slug>`
  route stamps its own `/social-card/guides` PNG og:image + alt.
- `tests/integration/social-card-raster.integration.test.ts` — guide card
  rasterizes to a real 1200x630 PNG.

## Test run

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 368 files / 4420 tests passed.
- `npx vitest run --configLoader runner --project workers
  tests/integration/social-card-raster.integration.test.ts`
  → 1 file / 5 tests passed.

## Live verification (local e2e fixture server, 127.0.0.1:4179)

Issue's verify block run against `npm run e2e:serve:local` (real workerd):

- `/guides/how-to-track-competitor-ads` og:image →
  `/social-card/guides/how-to-track-competitor-ads.png?n=How+to+track+competitor+ads`
  → 200 `image/png`, 1200x630, 32 KB.
- `/guides/how-to-monitor-meta-ad-library` og:image →
  `/social-card/guides/how-to-monitor-meta-ad-library.png?n=…` → 200
  `image/png`, 1200x630, 34 KB.
- `/guides/how-to-monitor-competitor-landing-page-changes` (the first #3093
  guide, already on main) inherits it with no per-page code → 200
  `image/png`, 1200x630, 33 KB.
- Visual check of the fetched PNG: brand token + "Five to Nine" wordmark,
  guide headline, "How-to guide · Five to Nine" subline, 0509.io footer.
