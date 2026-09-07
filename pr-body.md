## Locale cluster: no fake-lang English pages, hreflang cluster, regression gate (issue #1570)

The locale-prefixed buyer-surface cluster (`/de/pricing`, `/ja/help`, `/fr/docs`, `/es/status`, `/pt-br/compare`, ...) served byte-identical English copy while declaring `lang=de/ja/fr/es/pt-BR` and shipping zero hreflang — a duplicate-content doorway pattern (43 indexable surfaces that are 43 dupes of one page) and a WCAG 3.2.6 html-lang violation (screen readers announce English as German/Japanese).

This PR takes the issue's explicitly-sanctioned option for untranslated pages (accept #2): **set `lang="en"` and remove the pages from the locale sitemap set**, while keeping them reachable (200, canonical→EN) and emitting a full hreflang alternate cluster on every one.

### What changed

- **`htmlLangForPathname` now returns `"en"` for every buyer-surface locale path** (`app/lib/locale-markets.ts`). A page never claims a language its content does not speak. The genuinely translated sneaker-resale cluster (`/de/sneaker-resale` etc.) keeps its real locale lang.
- **Buyer-surface locale subpaths removed from the sitemap** (`app/lib/seo.ts`, `SITEMAP_PATHS`). They stay 200 and canonical→EN but are no longer advertised as 43 distinct indexable surfaces. The translated sneaker-resale cluster stays in the sitemap.
- **hreflang alternate cluster rendered with the correct lowercase `hreflang` attribute** (`app/lib/seo.ts`). `buyerSurfaceHreflangLinks(splat)` emits all 5 locales + `x-default`→EN from one helper, wired into every locale route (`$locale.help`, `$locale.pricing`, `$locale.docs`, `$locale.api.docs`, `$locale.status`, `$locale.changelog`, `$locale.trust`, `$locale.compare`, `$locale._index`). Previously the attribute was emitted as `hrefLang` (wrong casing — not a valid HTML attribute), so the cluster was invisible to crawlers.
- **Regression test `tests/locale-content-integrity.test.ts`** (accept #3): asserts every buyer-surface locale path reports `lang="en"`, every locale route ships an hreflang `x-default`→EN alternate, and every genuinely-translated sneaker-resale locale page (lang != en) renders a body that differs from its EN twin. A future worker adding another byte-identical English locale page tagged with a fake non-EN lang fails this test — no code review required to catch the regression.

### Rebase reconciliation (main moved 49 commits ahead)

Main landed issues #1563 (locale compare/switch child routes), #1578 (locale first-value search funnel), and #1561 (locale-scoped sitemaps) after this branch was cut. Those issues added locale child/first-value routes to the sitemap with non-EN lang — the exact duplicate-content doorway pattern #1570 ships to close. This PR extends #1570's decision to cover them:

- **`app/lib/public-markdown.ts`**: loosened the `LLMS_PAGE_DETAILS` type annotation from `Record<SITEMAP_PATHS[number], …>` to an inferred literal type with a separate `_llmsDetailsCoverSitemap` compile-time check. The old annotation rejected non-sitemap locale entries (dead data kept for when a page re-enters the sitemap) once the locale spreads left `SITEMAP_PATHS` and the type narrowed from `string` to a literal union.
- **`tests/seo/locale-child-routes.test.ts`** (#1563): updated to expect `lang="en"` for locale child routes (byte-identical English) and assert they are NOT in the sitemap. Fixed `hrefLang` → `hreflang` casing.
- **`tests/seo/locale-first-value-routes.test.ts`** (#1578): updated to expect `lang="en"` for locale first-value routes and assert they are NOT in any sitemap. Fixed `hrefLang` → `hreflang` casing.
- **`tests/seo/locale-sitemap.test.ts`** (#1561): updated to expect non-empty locale sitemaps only for locales with genuinely translated content (de, ja, pt-br — sneaker-resale). Locales with no translated content (fr, es) correctly emit an empty sitemap.
- **`tests/customer-claim-surface-registry.test.ts`**: resolved rebase conflict — kept the #1570 rationale (locale buyer-surface paths intentionally NOT in the sitemap) and reconciled with the #1481 compare-duplicate comment from main.

### Verification

Ran the full node + workers vitest suites in the repo checkout (no network dependency — the test mounts the app locally):

```
$ npx vitest run --configLoader runner --project node
Test Files  567 passed (567)
     Tests  6792 passed (6792)

$ npx vitest run --configLoader runner --project workers
Test Files  21 passed (21)
     Tests  121 passed (121)

$ npx vitest run --configLoader runner --project node tests/locale-content-integrity.test.ts
Test Files  1 passed (1)
     Tests  73 passed (73)

$ npx tsc -b
EXIT: 0
```

run-proof: `npx vitest run --configLoader runner --project node` → 567 files / 6792 tests passed; `--project workers` → 21 files / 121 tests passed; `tests/locale-content-integrity.test.ts` → 73 passed; `npx tsc -b` exit 0.

research: no external libraries or APIs introduced; all changes are internal to the repo's existing locale/SEO modules.

help-first: no new `bin/` files or CLI tools added.

Closes #1570
