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
  // Sneaker-resale publisher cluster (data/seed-lists/sneaker-resale.json,
  // issue #1547): host-derived labels would render "Stockx", "Newbalance",
  // "Kickscrew" on brand-page titles and internal link tiles.
  "stockx.com": "StockX",
  "goat.com": "GOAT",
  "asics.com": "ASICS",
  "puma.com": "PUMA",
  "newbalance.com": "New Balance",
  "footlocker.com": "Foot Locker",
  "dsw.com": "DSW",
  "jdsports.com": "JD Sports",
  "finishline.com": "Finish Line",
  "stadiumgoods.com": "Stadium Goods",
  "flightclub.com": "Flight Club",
  "kickscrew.com": "KICKS CREW",
  "solesavy.com": "SoleSavy",
  "underarmour.com": "Under Armour",
  "sneakerping.com": "SneakerPing",
};

export function publicBrandNameFromDomain(domain: string): string | null {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  return PUBLIC_BRAND_NAME_OVERRIDES[normalized] ?? null;
}
