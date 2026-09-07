# Issue #1563 — Locale compare/switch child routes

Branch: `claim/issue-1563`

## What changed

- Added 13 locale child route files under `app/routes/$locale.compare.*.tsx` and `app/routes/$locale.switch.*.tsx` that re-export the EN route's meta and default component.
- Registered the 13 children under the `:locale` layout in `app/routes.ts`.
- Extended `BUYER_SURFACE_PATHS` child list in `app/lib/locale-markets.ts` so `htmlLangForPathname` returns the locale's `lang` attribute for each child.
- Extended `SITEMAP_PATHS` and `LOCALE_BUYER_SURFACE_PRIORITY` in `app/lib/seo.ts` to include the 65 locale × child URLs.
- Updated the `/compare` hub in `app/routes/compare.tsx` to accept an optional `localePrefix` and emit locale-prefixed child links.
- Added `tests/seo/locale-child-routes.test.ts` as a regression canary.
- Updated `tests/customer-claim-surface-registry.test.ts` expected `sitemapPaths` to cover the new 65 URLs so the drift guard stays green.

## Verification

- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm test` — 6,534 passed, 0 failed (node + workers projects).
- `sgscan` — no new security findings.
- Local server (`npm run e2e:serve:local`, served on `127.0.0.1:4180` after port 4179 was in use):
  - `curl http://127.0.0.1:4180/api/health` → `{"status":"ok"}`.
  - `curl http://127.0.0.1:4180/api/health/deep` → contains `"d1":"ok"`.
  - All 65 `/<locale>/<compare|switch>/<slug>` combinations returned HTTP 200.
  - Sample page `<html lang>` attributes match locale (`de`, `fr`, etc.).
  - Canonical links point to `https://0509.io/<en-path>` and hreflang clusters include all 5 locales + x-default.
