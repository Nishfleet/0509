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
