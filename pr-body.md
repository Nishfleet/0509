## What

Fixes #1431: `/ads/notion.so` was noindex and missing from the sitemap despite verified Notion ads.

The noindex + sitemap gap was already closed by #1442 (indexability decoupled from the 14-day Aggression window) — the live page now renders indexable and is listed in `sitemap.xml`. This PR adds the durable regression test for the `notion.so` shape and closes the remaining acceptance gap: a bare-keyword `notion` search resolves `notion.com` (the registrable domain its result rows land on) but the indexable brand page is the open-ccTLD `/ads/notion.so`, so the BET 5 "See all Notion ads" link never fired.

## Changes

- `app/lib/ads-internal-links.server.ts`: `resolveIndexableBrandPageLinkForDomain` now falls back to the open-ccTLD brand page when the resolved domain is its generic-commercial twin (`notion.com` → `/ads/notion.so`), reusing the same one-directional open-ccTLD→generic-commercial matcher the verified-link classifier trusts. Bounded (≤500 indexable set), cache-only.
- `tests/ads-brand-page-indexability.test.ts`: regression test asserting a populated `/ads/notion.so` renders WITHOUT noindex and is in the sitemap; a 0-verified-ads `notion.so` stays out.
- `tests/ads-internal-links.test.ts`: tests for the open-ccTLD fallback.

## Verification

- `npx vitest run --configLoader runner --project node`: 561 files, 6661 tests passed.
- `npx vitest run --configLoader runner --project workers`: 20 files, 114 tests passed.
- `sgscan`: No new security findings.
- Live: `curl https://0509.io/ads/notion.so` → no noindex; `curl https://0509.io/sitemap.xml` → contains `ads/notion.so`.

run-proof: node+workers vitest suites green (6661 + 114 tests), sgscan clean.

net-positive-because: adds the durable regression test for the notion.so indexability metric plus the search-link handoff; the added lines are test coverage and a bounded cache-only fallback, not new machinery.

Closes #1431
