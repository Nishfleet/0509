/**
 * Public brand-name overrides for domains whose DNS label is not the brand
 * a buyer would search for. Used by every public surface that renders a brand
 * token from a domain: /ads/:domain <title>, H1 and JSON-LD, internal /ads
 * links, and search/watchlist labels.
 *
 * Do not scrape the live web for names. Add an explicit override when the
 * host-derived label would otherwise produce a public name like "Hm" or
 * "Bombayshavingcompany".
 */

export const PUBLIC_BRAND_NAME_OVERRIDES: Record<string, string> = {
  "hm.com": "H&M",
  "ouraring.com": "Oura",
  "bombayshavingcompany.com": "Bombay Shaving Company",
  "mcaffeine.com": "mCaffeine",
  "sugarcosmetics.com": "Sugar Cosmetics",
  "asos.com": "ASOS",
  "hubspot.com": "HubSpot",
  "ridgewallet.com": "Ridge Wallet",
};

export function publicBrandNameFromDomain(domain: string): string | null {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  return PUBLIC_BRAND_NAME_OVERRIDES[normalized] ?? null;
}
