# lane1/961-webpage-jsonld

## Intent

Add schema.org `WebPage` JSON-LD to the six public routes that were missing it:
`/api/docs`, `/privacy`, `/terms`, `/changelog`, `/trust`, and `/compare/meta-ad-library`.

## Files changed

- `app/routes/api.docs.tsx` — add `webPageJsonLd` + `jsonLdScriptProps` import and `<script>` block.
- `app/routes/privacy.tsx` — same.
- `app/routes/terms.tsx` — same.
- `app/routes/changelog.tsx` — same.
- `app/routes/trust.tsx` — same.
- `app/routes/compare.meta-ad-library.tsx` — same.
- `tests/public-info-structured-data.test.ts` — new route-render test covering all six pages.

## Verification

### Unit tests

```
npx vitest run tests/public-info-structured-data.test.ts
# Test Files  1 passed (1)
#      Tests  6 passed (6)

npx vitest run tests/compare-meta-ad-library.route.test.ts
# Test Files  1 passed (1)
#      Tests  3 passed (3)

npm run typecheck
# exit 0
```

### Local E2E server

- `npm run e2e:serve:local` started; `/api/health` returned 200.
- Local SSR curl checks:
  - `/api/docs` → `application/ld+json` + `"@type":"WebPage"` OK
  - `/privacy` → OK
  - `/terms` → OK
  - `/changelog` → OK
  - `/trust` → OK
  - `/compare/meta-ad-library` → OK
- Evidence saved:
  - `/tmp/verify-0509/health-deep.json`
  - `/tmp/verify-0509/privacy.html`
  - `/tmp/verify-0509/compare-meta-ad-library.html`

### Live status

This is a code-only change. The public site will reflect it after the next production deploy.
The current live `https://0509.io/compare/meta-ad-library` is 404 because the Worker bundle is
stale, so live verification is blocked on deploy; the local harness proves the fix.

## PR

- Branch: `lane1/961-webpage-jsonld`
- Closes: `Nishfleet/0509#961`
