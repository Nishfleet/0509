# Search Relevance Audit (updated 2026-07-14)

## Current candidate pipeline

1. `/search` loader reads `website` query param.
2. Search V2 parses a domain intent and derives a brand-sized discovery query (`nykaa.com` → `nykaa`) because Meta Ad Library does not provide native domain search.
3. Exact scope independently verifies candidates from landing-page, advertiser-domain, or resolved entity evidence before rendering them as connected to the website.
4. Broader scope can include unverified provider/text candidates, but verified and related counts and reasons remain separate.
5. Selected proof renders before the result list with source, cache freshness, capture status, match reason, and deterministic focus behavior.
6. Authenticated selections persist only server-canonical public Meta evidence; external proof cannot be recovered through the global ad lookup.

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

## Implemented correction (search v2 candidate)

1. **Query intent** — PSL-aware parser distinguishes `domain` vs `text` (`app/lib/search-query.ts`).
2. **Provider query** — domain intent uses the brand label for discovery (`okara.ai` → `okara`), then verifies the registrable domain after retrieval.
3. **Verified matching** — post-filter levels 1–5 only for exact results (`app/lib/search-domain-match.server.ts`).
4. **Broader opt-in** — stem/keyword candidates (level 6) only when `?broader=1`.
5. **Cache isolation** — `search-v2:domain:<domain>:<scope>:...` keys (`app/lib/search-v2.server.ts`).
6. **Identity resolution** — optional SSRF-safe homepage fetch (`app/lib/website-identity.server.ts`).
7. **Rollout** — the committed Worker configuration is `shadow`: legacy remains customer-visible while a separate V2 query emits aggregate comparison telemetry. Plaintext competitor domains are not logged.

## Rollout and rollback

- **Deploy order:** apply migration `0054_search_domain_identity_cache.sql`, deploy Worker with `SEARCH_ROLLOUT_MODE=shadow`, run the authorized live comparison canary, then promote to `v2` in a separate configuration change.
- **Rollback:** set `SEARCH_ROLLOUT_MODE=legacy` (immediate revert to unfiltered provider results + stem fallback behavior).

## Provider limitations

Meta Ad Library has no native domain-indexed search. Five to Nine must query broadly enough to discover candidates, then verify via landing/advertiser domains. Zero verified results is an honest outcome.
