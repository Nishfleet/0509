# Lane report — issue #2855 (JSON-LD structured data on public marketing pages)

## What the issue observed vs. live state

The issue's evidence (`grep -rn 'application/ld+json' app/routes app/components`
→ 0 matches; live fetches show no ld+json) under-read the real state: routes
never carry the literal — they emit JSON-LD through `jsonLdScriptProps()` in
`app/lib/seo.ts`, and the literal `application/ld+json` lives there. On
origin/main every sitemap surface already emitted WebPage+ JSON-LD; the true
gaps were the named per-type entities and the test.

## Changes

- `app/lib/seo.ts`: added `articleJsonLd` (Article entity for /guides/*) and
  `serviceJsonLd` (Service entity for category pages), both mirroring the
  existing builders' constraints — only facts the page already renders, no
  hardcoded prices.
- `app/routes/guides.how-to-track-competitor-ads.tsx`: emits Article
  (headline = the same `guideHeadline` const the h1 renders;
  datePublished/dateModified = 2026-09-09, the date the page's own copy
  states).
- `app/routes/competitor-monitoring.tsx`: emits Service
  (`serviceType: "Competitor monitoring software"`, provider = Five to Nine).
- `app/routes/compare.pulzifi.tsx`, `compare.spyland.tsx`,
  `compare.meta-ad-library.tsx`: added the shared `<Breadcrumbs>` component
  (Home → Competitor monitoring → <tool>) — the same visible trail +
  BreadcrumbList JSON-LD pair the six sibling compare pages already render.
  Redirect aliases (compare.foreplay, compare.visualping-ad-library) get no
  schema: they 301 to canonical winners.
- `tests/integration/structured-data.test.ts`: renders each key route's
  served markup (house pattern: renderToStaticMarkup + mocked react-router,
  same as tests/integration/ads-domain-page.test.ts), parses every
  ld+json block, and asserts the expected @type set per surface.

## Verification

- `npx vitest run --configLoader runner --project node tests/integration/structured-data.test.ts`
  → 12/12 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 355 files / 4318 tests pass.
- `sgscan --base origin/main` → no new security findings.
- `crgate` → not signed in on this machine (auth unavailable; flagged).

## Note on the issue's verify grep

`grep -c 'application/ld+json' app/routes -r` stays 0 by design — routes emit
via the shared helper; the literal lives once in `app/lib/seo.ts`. The
termination test is the real gate.
