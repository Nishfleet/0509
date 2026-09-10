## What

The locale sitemaps filtered `SITEMAP_STATIC_ENTRIES` by locale prefix, so `fr/es/sitemap.xml` served empty `<urlset></urlset>` and `de/ja/pt-br` listed only the sneaker-resale cluster — even though every `BUYER_SURFACE_PATHS` path serves 200 under every locale prefix (with a 6-locale hreflang cluster). robots.txt advertised de/ja/pt-br sitemaps but not fr/es.

This PR rewrites `staticSitemapEntriesForLocale` to derive the locale feed from the buyer-surface cluster — `BUYER_SURFACE_PATHS` + compare/switch children (`BUYER_SURFACE_CHILD_PATHS`) + the `/guides/*` how-to cluster — the single source of truth in `app/lib/locale-markets.ts` (and the guide path in `SITEMAP_PATHS`). Each entry reuses the EN changefreq/priority from `SITEMAP_STATIC_ENTRIES` so the two can never drift. The genuinely translated sneaker-resale cluster stays for de/ja/pt-br.

`LOCALE_SITEMAP_LOCALES` now covers all five buyer-surface locales, so robots.txt advertises `Sitemap:` lines for fr/es too.

The `/guides/*` entry is advertised in the locale sitemaps (per the judge edit), so it must serve 200 under every locale prefix. It had no locale-prefixed route, so this PR adds `app/routes/$locale.guides.how-to-track-competitor-ads.tsx` (re-exporting the EN guide, canonical→EN, matching the #1501 pattern) and registers it in `app/routes.ts`. This is the one file outside the issue's `files:` list, required to satisfy the "no entry for a non-200 path" acceptance criterion.

## Verification

Ran the full suite to green:

```
Test Files  659 passed (659)   [node project]
Tests       7871 passed (7871)
Test Files  51 passed (51)     [workers project]
Tests       247 passed (247)
```

`/fr/sitemap.xml` now emits 24 URLs (≥13 accept). `tests/sitemap.server.test.ts` asserts the locale feed count equals the `BUYER_SURFACE_PATHS`-derived count, that every locale sitemap URL is a registered route (no 404 entry), and that every buyer-surface path is present in `SITEMAP_STATIC_ENTRIES` (no silent drop).

run-proof: `npm test` — 659 node files / 7871 tests + 51 workers files / 247 tests, all green.

net-positive-because: the diff is net-positive because it adds the acceptance tests for the locale feed count, route reachability, and derivation-source cross-check, plus the locale guide route; the source change itself is a small rewrite of one function plus a one-line constant.

research: no new bin/ tool — this is a source + test change inside existing organs.
help-first: no new bin/ tool.

## Reviewer round

Reviewer seat: `cursor/cursor-grok-4.6-high`.

- **Act on** — the `/guides/*` entry was added to every locale sitemap but had no locale-prefixed route, so `/fr/guides/how-to-track-competitor-ads` (and de/ja/pt-br/es) returned 404, violating "no entry for a non-200 path". Fixed by adding `$locale.guides.how-to-track-competitor-ads.tsx` + registering it in `app/routes.ts`.
- **Act on** — the count test did not verify each URL returns 200. Added a test asserting every locale sitemap URL is a registered route.
- **Consider** — `if (!en) continue;` could silently drop a path missing from `SITEMAP_STATIC_ENTRIES`. Added a cross-check test asserting every buyer-surface path is present in `SITEMAP_STATIC_ENTRIES`.
- **Consider** — the guide path is a literal rather than derived from a shared guides list. Kept as a literal with a clear comment; there is no shared guides list to derive from.

Closes #2294
