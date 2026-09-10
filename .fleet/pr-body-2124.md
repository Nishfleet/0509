## Why

Issue #2124 — every sitemap-canonical `/compare/*` page carries zero interior links to a live `/ads/:domain` worked example. Live audit (2026-09-09): `/compare/visualping-ad-libraries`, `/compare`, and `/compare/foreplay-spyder` all have 0 `/ads/` hrefs and 0 `/timeline/` hrefs, while 52 `/ads/:domain` pages sit in the sitemap and `/ads/nike.com` returns 200 with 14 verified ads. A comparison page that only asserts "domain paste + proof" without showing one proof page is parity copy — a paragraph a chat prompt could write. The unpaid-distribution direction needs these pages to convert comparison-intent into a signed-in watch; the missing worked example is the conversion leak.

## Scope

- `app/components/live-brand-proof.tsx` (new) — a "See it on a live brand" block that links a tracked `/ads/:domain` page (nike.com) plus its `/timeline/:domain` offer history. The linked domain is a tracked demo brand from the production sitemap (never a screenshot fixture, never a vendor-owned domain).
- `app/lib/demo-brand-pages.ts` (modified) — adds `LIVE_BRAND_PROOF_DOMAIN` (nike.com), the tracked demo brand whose production `/ads/nike.com` returns 200 with verified ads and whose `/timeline/nike.com` offer-history page is live.
- `app/routes/compare.{magicbrief,meta-ad-library,visualping-ad-libraries,spyland,pulzifi,foreplay-spyder,panoramata,adspyder}.tsx` (modified) — each sitemap-canonical compare page renders the `LiveBrandProof` block.
- `app/routes/compare.tsx` (modified) — the `/compare` hub renders the same worked example, so it no longer sits at zero `/ads/` hrefs.
- `tests/compare-live-brand-proof.test.tsx` (new) — asserts each sitemap-canonical compare route's rendered HTML contains ≥1 `href="/ads/<domain>"` whose domain is in the tracked-brand fixture, and that the `/compare` hub does too.

No new compare subjects. No migrations. No workflows touched.

## Verification

Live production evidence (2026-09-10):

```
/ads/nike.com    → HTTP 200, 86KB (verified ads)
/timeline/nike.com → HTTP 200, 25KB (offer history)
/compare/visualping-ad-libraries → 0 /ads/ hrefs (before fix)
/compare → 0 /ads/ hrefs (before fix)
/compare/foreplay-spyder → 0 /ads/ hrefs (before fix)
sitemap.xml lists 8 /compare URLs and 52 /ads URLs
```

The 8 sitemap-canonical compare pages match the test's `SITEMAP_CANONICAL_COMPARE_PAGES` fixture exactly.

run-proof: unit tests

```
npx vitest run --configLoader runner --project node tests/compare-live-brand-proof.test.tsx
```

→ 9 tests passed (8 compare pages + hub), each asserting ≥1 tracked `/ads/<domain>` link.

Full node suite regression:

```
npx vitest run --configLoader runner --project node
```

→ 651 files, 7737 tests passed.

Type check:

```
npm run typecheck
```

→ exit 0 (after installing the declared `@resvg/resvg-wasm` dependency that was missing from the local node_modules; the file it affects is not touched by this PR).

## Rollback

Revert the PR; compare pages lose the worked-example block. No data touched.

Closes #2124
