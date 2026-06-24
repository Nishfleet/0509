# Search Relevance Audit (2026-06-24)

## Current pipeline (pre-v2)

1. `/search` loader reads `website` query param.
2. `normalizeCompetitorWebsiteInput` parses the URL and derives `searchTerm` via `inferSearchTermFromHost` (first label only).
3. `applyWebsiteSearchFallback` copies `searchTerm` into `filters.query` when no explicit query is present.
4. `searchAdsViaSourceResolver` calls Meta Ad Library browser scraping with `keyword_exact_phrase` and `q=<searchTerm>`.
5. Results are hydrated in `prepareSearchResultSelection` and rendered without destination verification.

## Reproduced failure (`okara.ai`)

- Input: `https://okara.ai`
- Derived query: `okara` (hostname stem)
- Provider: Meta Ad Library exact phrase search for `okara`
- Unrelated match: **ESHAL HOMEOPATHIC CLINIC OKARA** (geography/ad-copy keyword match on “Okara”, not `okara.ai`)

## Root cause

Domain website searches were degraded to unrestricted keyword search on the first hostname label (`okara.ai` → `okara`) with no post-filter against landing/advertiser domains.

Key files:

- `app/lib/competitor-website.ts` — stem extraction (`inferSearchTermFromHost`)
- `app/lib/competitor-website.ts` — `applyWebsiteSearchFallback`
- `app/lib/meta-library-browser.server.ts` — `buildSearchUrl` uses keyword search
- `app/routes/search.tsx` — no verified-domain empty state or broader opt-in

## Planned correction (search v2)

1. **Query intent** — PSL-aware parser distinguishes `domain` vs `text` (`app/lib/search-query.ts`).
2. **Provider query** — domain intent uses registrable domain (`okara.ai`), not stem (`okara`).
3. **Verified matching** — post-filter levels 1–5 only for exact results (`app/lib/search-domain-match.server.ts`).
4. **Broader opt-in** — stem/keyword candidates (level 6) only when `?broader=1`.
5. **Cache isolation** — `search-v2:domain:<domain>:<scope>:...` keys (`app/lib/search-v2.server.ts`).
6. **Identity resolution** — optional SSRF-safe homepage fetch (`app/lib/website-identity.server.ts`).
7. **Rollout** — `SEARCH_ROLLOUT_MODE=legacy|shadow|v2` (default `legacy`).

## Rollout and rollback

- **Deploy order:** apply migration `0054_search_domain_identity_cache.sql`, deploy Worker with `SEARCH_ROLLOUT_MODE=shadow`, validate `okara.ai`, then set `v2`.
- **Rollback:** set `SEARCH_ROLLOUT_MODE=legacy` (immediate revert to unfiltered provider results + stem fallback behavior).

## Provider limitations

Meta Ad Library has no native domain-indexed search. Five to Nine must query broadly enough to discover candidates, then verify via landing/advertiser domains. Zero verified results is an honest outcome.
