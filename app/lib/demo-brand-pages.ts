/**
 * BET 3 flagship demo brands. Their public `/ads/:domain` pages are the
 * programmatic acquisition surface the Offer Timeline backfill depends on.
 * Keep this list as the five names in the category-research seed — do not
 * silently add a sixth here.
 */
export const DEMO_BRAND_PAGE_DOMAINS = [
  "nike.com",
  "nykaa.com",
  "allbirds.com",
  "lenskart.com",
  "mamaearth.com",
] as const;

export type DemoBrandPageDomain = (typeof DEMO_BRAND_PAGE_DOMAINS)[number];

/**
 * The domain the free-preview CTAs search (issue 2123): switch pages and the
 * sitemap-canonical compare pages land their "Try the free preview" button
 * on a `/search` for this tracked demo brand, whose production /search
 * returns verified ads. Vendor-owned domains (for example
 * visualping.io) render "0 ads found" and must never be the search target —
 * copy may name the vendor, the query must not.
 */
export const FREE_PREVIEW_SEARCH_DOMAIN: DemoBrandPageDomain =
  DEMO_BRAND_PAGE_DOMAINS[0];

/**
 * The tracked demo brand the sitemap-canonical `/compare/*` pages link to as
 * their "See it on a live brand" worked example (issue 2124). Must be a
 * domain whose production `/ads/:domain` page returns HTTP 200 with verified
 * ads and is listed in the live sitemap — never a screenshot fixture, never a
 * vendor-owned domain. nike.com also has a live `/timeline/nike.com` offer
 * history page, so the proof block can link both surfaces.
 */
export const LIVE_BRAND_PROOF_DOMAIN: DemoBrandPageDomain =
  DEMO_BRAND_PAGE_DOMAINS[0];
