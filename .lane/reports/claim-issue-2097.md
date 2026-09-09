# Lane evidence — claim/issue-2097

Issue: Nishfleet/0509#2097
Branch: `claim/issue-2097`
Date: 2026-09-09

## Goal

Prevent `/ads/:domain` and `/timeline/:domain` from SSR-ing the generic
"Something went wrong" error-boundary body under HTTP 200. Add a body-level
gate that catches regressions across representative proof-route domains.

## Changes

- `app/routes/ads.$domain.tsx` — wrapped the core loader in a body-level gate:
  any uncaught error degrades to an honest 503 ("Temporarily unavailable")
  instead of bubbling to the root ErrorBoundary as a 200 "Something went
  wrong". Thrown Responses (404, 301 redirect, 429) pass through unchanged.
  Added a 4s `promiseWithTimeout` bound on the primary `loadBrandPageCacheSnapshot`
  D1 read (inside the existing `withTransientRetry`) so a hung D1 read degrades
  to the cache-miss redirect instead of stalling SSR.
- `app/routes/timeline.$domain.tsx` — same body-level gate (503 on uncaught
  error, Responses pass through). Added `withTransientRetry` +
  `promiseWithTimeout` (4s) around the primary `loadOfferTimeline` read so a
  hung D1 read degrades to the noindex empty-ledger shell instead of stalling.
- `scripts/check-proof-surface.mjs` — NEW body-level SSR gate. Fetches a
  seeded set (>=5 `/ads` + >=2 `/timeline`, >=10 distinct total) and FAILs if
  any 200 response contains "Something went wrong" / "Something broke on our
  side loading this page" or the generic non-brand `<title>` ("Five to Nine"
  fallback the ErrorBoundary renders under). Reads the indexable set from
  `/sitemap.xml` by default; `--ads=`/`--timeline=` override with an explicit
  set. Additive — does not touch the #1931 cross-link sweep or #2052 canary.
- `package.json` — added `check:proof-surface` script entry.
- `tests/proof-surface-error-boundary-gate.test.ts` — NEW unit tests proving
  both routes degrade a residual throw to 503 (never the error boundary under
  200) and pass thrown Responses (404, 410) straight through.

## Verification

### Typecheck

```
$ npx tsc --noEmit
(exit 0, no errors)
```

### Unit tests (focused)

```
$ npx vitest run tests/proof-surface-error-boundary-gate.test.ts tests/ads-brand-page.route.test.ts tests/offer-timeline.route.test.ts tests/timeline-410-error-boundary.test.tsx
Test Files  4 passed (4)
     Tests  61 passed (61)
```

### Broader ads/timeline suite (no regression)

```
$ npx vitest run tests/ads-brand-page tests/offer-timeline tests/timeline tests/ads-internal-links
Test Files  15 passed (15)
     Tests  229 passed (229)
```

### Issue verify commands (live, https://0509.io)

```
$ curl -sS https://0509.io/ads/allbirds.com | grep -q 'Allbirds' && echo PASS
PASS (contains Allbirds)

$ curl -sS https://0509.io/ads/stripe.com | grep -c 'Something went wrong'
0   (zero error-boundary bodies)

$ node scripts/check-proof-surface.mjs --ads=allbirds.com,stripe.com,nike.com,figma.com,hm.com --timeline=allbirds.com,nike.com
OK: 7 sampled 200 proof pages (7 distinct: 5 /ads + 2 /timeline) rendered brand bodies with no error-boundary SSR under 200.
```

### Sitemap-based run (>=10 distinct domains)

```
$ node scripts/check-proof-surface.mjs --max-ads=8 --max-timeline=4 --verbose
seed set: 8 /ads + 4 /timeline (https://0509.io)
  ads/adidas.com -> 200, title="Adidas Facebook & Instagram ads | Five to Nine"
  ads/adobe.com -> 200, title="Adobe: Meta ads linking to adobe.com ..."
  ads/allbirds.com -> 200, title="Allbirds: Meta ads linking to allbirds.com ..."
  ads/amazon.com -> 200, title="Amazon: Meta ads linking to amazon.com ..."
  ads/asics.com -> 200, title="Asics: Meta ads linking to asics.com ..."
  ads/asos.com -> 200, title="ASOS Facebook & Instagram ads | Five to Nine"
  ads/atlassian.com -> 200, title="Atlassian: Meta ads linking to atlassian.com ..."
  ads/bombas.com -> 200, title="Bombas Facebook & Instagram ads | Five to Nine"
  timeline/adspyder.io -> 200, title="Adspyder offer timeline | Five to Nine"
  timeline/allbirds.com -> 200, title="Allbirds offer timeline | Five to Nine"
  timeline/calendly.com -> 200, title="Calendly offer timeline | Five to Nine"
  timeline/lenskart.com -> 200, title="Lenskart offer timeline | Five to Nine"
OK: 12 sampled 200 proof pages (12 distinct: 8 /ads + 4 /timeline) rendered brand bodies with no error-boundary SSR under 200.
```

12 distinct domains (8 `/ads` + 4 `/timeline`), all 200 with brand titles,
zero error-boundary bodies.
