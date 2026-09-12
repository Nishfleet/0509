# Lane evidence — claim/issue-3114 (Nishfleet/0509#3114)

## Task

/compare, /methodology/ad-aggression-score, /brands, /sample-brief and
/briefs/weekly all served the site-wide generic `/og-image.png` as og:image
while /ads/*, /timeline/*, the cluster surfaces and (since #3112) /guides/*
serve page-specific rasterized cards. These five are the acquisition
surfaces (the issue's funnel_stage: visit), so their share previews carried
zero page-specific information.

## Approach

Registry auto-derivation in `publicSeoMeta`, the #3098 mechanism with a
fixed-pathname key: `STATIC_SURFACE_SOCIAL_CARDS` (seo.ts) maps each of the
five exact pathnames to a card slug + copy + alt. One source of truth —
`publicSeoMeta` stamps the page's og:image from the registry and
`social-cards.server.ts` renders the card body from the same entries, so the
two cannot drift. Zero per-page wiring: the five routes (and the
`$locale.compare` / `$locale.methodology` re-exports) keep calling
`publicSeoMeta` exactly as before. No new design direction: same 1200×630
frame, bone/ink/signal-green tokens, #2101 rasterization pipeline — new
`surface` kind riding the existing PNG branch in `workers/app.ts`.

Card URL paths (flat slugs, both `.png` + legacy `.svg` alias accepted):
`/social-card/compare.png`, `/social-card/methodology-ad-aggression-score.png`,
`/social-card/brands.png`, `/social-card/sample-brief.png`,
`/social-card/briefs-weekly.png`.

Boundary kept (accept 2): the per-tool `/social-card/compare/<tool>.svg`,
`/social-card/switch/*` and `/social-card/brand/<category>.svg` cards are
untouched — their SVG→PNG blank-on-scrapers defect is #3104's scope.

## Changes

- `app/lib/seo.ts` — `STATIC_SURFACE_SOCIAL_CARDS` registry (pathname →
  slug/copy/alt) + `staticSurfaceSocialCardForPathname`, wired into
  `publicSeoMeta` after the guide auto-derivation (explicit
  `ogImageUrl`/`ogImageAlt` still wins).
- `app/lib/social-cards.server.ts` — new `surface` card kind: parse branch
  before the cluster matcher (same top-level shape, registry-gated so
  unknown slugs still 404), render branch reading copy straight from the
  shared registry, 24h cache (static page copy, not live data).
- `workers/app.ts` — `surface` added to the PNG rasterization branch.
- `tests/social-cards.test.ts` — parse cases (both extensions + unknown-slug
  null), a registry-driven render test (kind/copy/cacheControl), and a
  registry-driven route sweep: each of the five routes' real `meta()` must
  stamp exactly its `/social-card/<slug>.png` og:image + alt + `image/png`
  type + twitter mirror, and the stamped URL must resolve to a served
  surface-kind card.
- `tests/integration/social-card-raster.integration.test.ts` — the compare
  surface card rasterizes to a real 1200×630 PNG on workerd.

## Visual fit fix (caught in review, worth recording)

`renderCard`'s `clampLine` is a character guard, not a rendered-width guard.
The first-draft headlines "Compare Five to Nine vs the alternatives" (40
chars) and "Ad Aggression Score methodology" (31 chars) clipped off the
right edge of the 1200px card at the 68px headline size (verified by viewing
the served PNGs); the practical budget is ~29 chars. Final copy: the compare
card's headline is "Compare Five to Nine" with the subline carrying "vs the
alternatives — side by side, source-backed"; the methodology card's headline
is "Ad Aggression Score" with subline "The methodology: four public parts,
0–100". The card still names its own surface, never one tool (the /ads
honesty rule). The three other headlines (25/19/29 chars) verified
pixel-clean.

## Test run

- `npx vitest run --configLoader runner --project node tests/social-cards.test.ts`
  → 1 file / 70 tests passed.
- `npx vitest run --configLoader runner --project workers
  tests/integration/social-card-raster.integration.test.ts`
  → 1 file / 6 tests passed.
- `npx vitest run --configLoader runner --project node` (full suite)
  → 755 files / 9655 tests passed.
- `npx tsc -b` → exit 0. `sgscan` → no new security findings.

## Live verification (local e2e fixture server, 127.0.0.1:4179)

Issue's verify pattern against `npm run e2e:serve:local` (real workerd;
origin differs from production, so og:image paths checked rather than the
literal 0509.io URL, which only flips after deploy):

- `/compare` og:image → `/social-card/compare.png` → 200 `image/png`,
  1200×630, 33.6 KB, viewed: brand token + wordmark, "Compare Five to Nine"
  headline, "vs the alternatives — side by side, source-backed" subline.
- `/methodology/ad-aggression-score` og:image →
  `/social-card/methodology-ad-aggression-score.png` → 200 `image/png`,
  1200×630, 33.1 KB, viewed: "Ad Aggression Score" + "The methodology: four
  public parts, 0–100".
- `/brands` og:image → `/social-card/brands.png` → 200 `image/png`,
  1200×630, 34.9 KB, viewed: "Browse all tracked brands".
- `/sample-brief` og:image → `/social-card/sample-brief.png` → 200
  `image/png`, 1200×630, 34.1 KB, viewed: "A real Monday brief".
- `/briefs/weekly` og:image → `/social-card/briefs-weekly.png` → 200
  `image/png`, 1200×630, 37.8 KB, viewed: "Weekly competitor offer moves".
- None of the five serves the generic og-image.png anymore (the issue's
  verify contract, modulo deploy).
- Boundary: `/social-card/compare/panoramata.svg` and
  `/social-card/brand/sport-footwear.svg` still serve `image/svg+xml`
  (#3104 scope untouched); the `/social-card/compare.svg` alias serves PNG
  like the other rasterized kinds.
