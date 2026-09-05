## Locale cluster: no fake-lang English pages, hreflang cluster, regression gate (issue #1570)

The locale-prefixed buyer-surface cluster (`/de/pricing`, `/ja/help`, `/fr/docs`, `/es/status`, `/pt-br/compare`, ...) served byte-identical English copy while declaring `lang=de/ja/fr/es/pt-BR` and shipping zero hreflang — a duplicate-content doorway pattern (43 indexable surfaces that are 43 dupes of one page) and a WCAG 3.2.6 html-lang violation (screen readers announce English as German/Japanese).

This PR takes the issue's explicitly-sanctioned option for untranslated pages (accept #2): **set `lang="en"` and remove the pages from the locale sitemap set**, while keeping them reachable (200, canonical→EN) and emitting a full hreflang alternate cluster on every one.

### What changed

- **`htmlLangForPathname` now returns `"en"` for every buyer-surface locale path** (`app/lib/locale-markets.ts`). A page never claims a language its content does not speak. The genuinely translated sneaker-resale cluster (`/de/sneaker-resale` etc.) keeps its real locale lang.
- **Buyer-surface locale subpaths removed from the sitemap** (`app/lib/seo.ts`, `SITEMAP_PATHS`). They stay 200 and canonical→EN but are no longer advertised as 43 distinct indexable surfaces. The translated sneaker-resale cluster stays in the sitemap.
- **hreflang alternate cluster rendered with the correct lowercase `hreflang` attribute** (`app/lib/seo.ts`). `buyerSurfaceHreflangLinks(splat)` emits all 5 locales + `x-default`→EN from one helper, wired into every locale route (`$locale.help`, `$locale.pricing`, `$locale.docs`, `$locale.api.docs`, `$locale.status`, `$locale.changelog`, `$locale.trust`, `$locale.compare`, `$locale._index`). Previously the attribute was emitted as `hrefLang` (wrong casing — not a valid HTML attribute), so the cluster was invisible to crawlers.
- **Regression test `tests/locale-content-integrity.test.ts`** (accept #3): asserts every buyer-surface locale path reports `lang="en"`, every locale route ships an hreflang `x-default`→EN alternate, and every genuinely-translated sneaker-resale locale page (lang != en) renders a body that differs from its EN twin. A future worker adding another byte-identical English locale page tagged with a fake non-EN lang fails this test — no code review required to catch the regression.

### Verification

Ran the full node + workers vitest suites in the repo checkout (no network dependency — the test mounts the app locally):

```
$ npx vitest run --configLoader runner --project node
Test Files  544 passed (544)
     Tests  6578 passed (6578)

$ npx vitest run --configLoader runner --project workers
Test Files  20 passed (20)
     Tests  114 passed (114)

$ npx vitest run --configLoader runner --project node tests/locale-content-integrity.test.ts
Test Files  1 passed (1)
     Tests  53 passed (53)

$ npx tsc -b
EXIT: 0

$ sgscan
No new security findings.
```

run-proof: `npx vitest run --configLoader runner --project node` → 544 files / 6578 tests passed; `--project workers` → 20 files / 114 tests passed; `tests/locale-content-integrity.test.ts` → 53 passed; `npx tsc -b` exit 0; `sgscan` no findings.

net-positive-because: the +155 net lines are almost entirely the new `tests/locale-content-integrity.test.ts` regression gate (177 lines) that the issue's accept #3 requires as the prevention gate; the production diff (`locale-markets.ts`, `seo.ts`) is net-negative.

Closes #1570
