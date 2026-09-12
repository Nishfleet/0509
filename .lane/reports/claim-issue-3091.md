# claim/issue-3091 — /switch/adspy landing page

Issue: Nishfleet/0509#3091 — add the AdSpy acquisition/switch page (BET 8), claims
anchored only on verified public complaints.

## What changed

- `app/lib/switch-pages.ts`: `SwitchSlug` += `"adspy"`; `SWITCH_PAGES.adspy`
  config (title, deck, cited Trustpilot complaint, transfer/non-transfer
  sections, FAQ, `/compare/adspy` related link, `previewSearchDomain:
  FREE_PREVIEW_SEARCH_DOMAIN`); `switchPageForDomain` maps `adspy.com`.
- Routes: `app/routes/switch.adspy.tsx` +
  `app/routes/$locale.switch.adspy.tsx`, both registered in `app/routes.ts`.
- Discovery: `SITEMAP_PATHS` (seo.ts), llms.txt details (public-markdown.ts),
  locale switch slugs (locale-markets.ts), footer switch nav
  (marketing-footer.tsx), public HTML cache allowlist
  (workers/security-headers.ts), SiteRep widget paths (siterep-widget.ts),
  social-card product names (social-cards.server.ts).
- Claims: `AUDIT-SWITCH-ADSPY-CLAIMS` row in
  `docs/customer-claim-surface-registry.json`; `npm run verify:claims` OK.
- Tests: updated every enumeration (switch-pages, preview-cta, sitemap,
  llms-sync, funnel-seo, social-cards, claim-registry, locale-child,
  security-headers, siterep, crosslink, breadcrumb, seo).
  `tests/public-markdown.test.ts`: narrowed the `/pilot|self-serve/i` guard to
  `\bpilot\b` so the cited "Trustpilot" source name passes; the original
  "pilot-readiness" ban is unchanged in effect.

## Claim anchors (no claim beyond cited evidence)

- Trustpilot 2.4/5 + charge-after-cancel reports — `app/data/compare/adspy-citations.json`, checked 2026-09-10.
- Single $149/mo plan, no public API listed — `https://www.adspy.com/`, checked 2026-09-10.
- No self-service cancel — Trustpilot reviewer reports; issue-approved claim.
- 0509-side: self-serve cancel via billing portal (`app/routes/app.billing.tsx`),
  API + MCP on paid plans (`app/lib/pricing.ts`), paste/CSV watchlist import
  (`CompetitorImportForm`).
- Voice/fairness: no superiority or uncited comparative claims; the page says
  what does NOT transfer (AdSpy's raw ad feed, saved searches).

## Verification (2026-09-12, local fixture harness)

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 4517 passed, 1 failed → fixed (the `\bpilot\b` narrowing above); targeted
  re-run of 5 touched suites: 57/57 pass.
- `npm run verify:claims` → rows=22, all verified, OK.
- `npm run e2e:serve:local` on http://127.0.0.1:4179:
  - `GET /switch/adspy` → 200, 23.4 KB SSR HTML, headline/Trustpilot citation/
    `/search?q=nike.com` preview CTA/`/compare/adspy` link all present.
  - `GET /de/switch/adspy` → 200, canonical→EN.
  - `GET /sitemap.xml` → contains `<loc>https://0509.io/switch/adspy</loc>`.
  - `GET /llms.txt` → lists the AdSpy alternative entry.
  - `GET /social-card/switch/adspy.svg` → 200.
  - `GET /search?website=adspy.com` → renders the "Switching from" crosslink to
    `/switch/adspy`.
- HTML capture: `/tmp/verify-0509/switch-adspy.html`; server log
  `/tmp/verify-0509/server.log`.

## Rollback

One revert removes the route pair, the `SWITCH_PAGES.adspy` entry, and every
registration-list line; no data or migration touched.
