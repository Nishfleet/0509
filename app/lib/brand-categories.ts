/**
 * Category registry for the public /brands hub (issue #1417).
 *
 * The /ads/:domain brand pages are the natural landing surface for
 * "{brand} facebook ads" queries, but until #1417 each was an orphan: the
 * ~30 sitemap /ads pages never linked to each other and no hub linked them
 * all. The hub groups the indexable brand pages by a coarse buyer category
 * so a visitor who lands on /ads/nike.com can find /ads/adidas.com — the
 * whole point of the cross-linking is discovery between comparable brands.
 *
 * The registry covers every domain the product publishes or seeds: the
 * production sitemap's live /ads set, the `data/seed-lists/*.json` publisher
 * clusters, the discovery eval panel, the demo brand pages, and the public
 * brand-name overrides (issue #3126 — the original 14-domain demo map left
 * ~100 published domains in "More brands" and six of seven category pages
 * near-empty). It stays honest: it never guesses a brand. Every domain
 * absent from the map groups under BRAND_CATEGORY_OTHER — reserved for
 * domains no buyer category genuinely fits. The grouping label has no
 * ranking weight — it exists purely so the hub reads as a categorized
 * browse surface instead of one flat list.
 */

/** Coarse buyer categories for the public /brands hub grouping. */
export const BRAND_CATEGORIES: Readonly<Record<string, string>> = {
  // Sport & footwear — athletic brands, shoe retailers, sneaker resale.
  "adidas.com": "Sport & footwear",
  "allbirds.com": "Sport & footwear",
  "asics.com": "Sport & footwear",
  "converse.com": "Sport & footwear",
  "crocs.com": "Sport & footwear",
  "decathlon.com": "Sport & footwear",
  "dsw.com": "Sport & footwear",
  "finishline.com": "Sport & footwear",
  "flightclub.com": "Sport & footwear",
  "footlocker.com": "Sport & footwear",
  "goat.com": "Sport & footwear",
  "gymshark.com": "Sport & footwear",
  "hoka.com": "Sport & footwear",
  "jdsports.com": "Sport & footwear",
  "kickscrew.com": "Sport & footwear",
  "lululemon.com": "Sport & footwear",
  "newbalance.com": "Sport & footwear",
  "nike.com": "Sport & footwear",
  "on.com": "Sport & footwear",
  "puma.com": "Sport & footwear",
  "reebok.com": "Sport & footwear",
  "saucony.co.uk": "Sport & footwear",
  "saucony.com": "Sport & footwear",
  "solesavy.com": "Sport & footwear",
  "stadiumgoods.com": "Sport & footwear",
  "stockx.com": "Sport & footwear",
  "underarmour.com": "Sport & footwear",
  "vans.com": "Sport & footwear",

  // E-commerce — broad multi-category marketplaces and mass retail.
  "amazon.com": "E-commerce",
  "ebay.com": "E-commerce",
  "walmart.com": "E-commerce",

  // Beauty & personal care — cosmetics, skincare, grooming, beauty retail.
  "anastasiabeverlyhills.com": "Beauty & personal care",
  "birchbox.com": "Beauty & personal care",
  "bombayshavingcompany.com": "Beauty & personal care",
  "colourpop.com": "Beauty & personal care",
  "dermstore.com": "Beauty & personal care",
  "dotandkey.com": "Beauty & personal care",
  "dove.com": "Beauty & personal care",
  "elfcosmetics.com": "Beauty & personal care",
  "forestessentials.com": "Beauty & personal care",
  "glossier.com": "Beauty & personal care",
  "glowrecipe.com": "Beauty & personal care",
  "hudabeauty.com": "Beauty & personal care",
  "kamaayurveda.com": "Beauty & personal care",
  "kyliecosmetics.com": "Beauty & personal care",
  "mamaearth.com": "Beauty & personal care",
  "mamaearth.in": "Beauty & personal care",
  "mcaffeine.com": "Beauty & personal care",
  "narscosmetics.com": "Beauty & personal care",
  "nykaa.com": "Beauty & personal care",
  "olay.com": "Beauty & personal care",
  "paulaschoice.com": "Beauty & personal care",
  "plumgoodness.com": "Beauty & personal care",
  "sephora.com": "Beauty & personal care",
  "sugarcosmetics.com": "Beauty & personal care",
  "summerfridays.com": "Beauty & personal care",
  "tatcha.com": "Beauty & personal care",
  "thedermaco.com": "Beauty & personal care",
  "theordinary.com": "Beauty & personal care",
  "ulta.com": "Beauty & personal care",
  "wowskinscience.com": "Beauty & personal care",

  // SaaS & software — software and platform companies selling to businesses
  // or prosumers.
  "adobe.com": "SaaS & software",
  "airtable.com": "SaaS & software",
  "asana.com": "SaaS & software",
  "atlassian.com": "SaaS & software",
  "canva.com": "SaaS & software",
  "celonis.com": "SaaS & software",
  "clickup.com": "SaaS & software",
  "curofy.com": "SaaS & software",
  "figma.com": "SaaS & software",
  "freshworks.com": "SaaS & software",
  "hubspot.com": "SaaS & software",
  "mailchimp.com": "SaaS & software",
  "monday.com": "SaaS & software",
  "notion.so": "SaaS & software",
  "okara.ai": "SaaS & software",
  "personio.com": "SaaS & software",
  "plausible.io": "SaaS & software",
  "razorpay.com": "SaaS & software",
  "shopify.com": "SaaS & software",
  "siemens.com": "SaaS & software",
  "slack.com": "SaaS & software",
  "tcs.com": "SaaS & software",
  "zendesk.com": "SaaS & software",
  "zoho.com": "SaaS & software",

  // Fashion & accessories — apparel, footwear-adjacent fashion, eyewear and
  // other wearable accessories.
  "asos.com": "Fashion & accessories",
  "bewakoof.com": "Fashion & accessories",
  "bombas.com": "Fashion & accessories",
  "clovia.com": "Fashion & accessories",
  "damensch.com": "Fashion & accessories",
  "hm.com": "Fashion & accessories",
  "hugo-boss.com": "Fashion & accessories",
  "hypebeast.com": "Fashion & accessories",
  "lenskart.com": "Fashion & accessories",
  "libas.in": "Fashion & accessories",
  "ridgewallet.com": "Fashion & accessories",
  "rothys.com": "Fashion & accessories",
  "snitch.co.in": "Fashion & accessories",
  "thesouledstore.com": "Fashion & accessories",
  "warbyparker.com": "Fashion & accessories",
  "xyxxcrew.com": "Fashion & accessories",
  "zalando.de": "Fashion & accessories",
  "zara.com": "Fashion & accessories",
  "zivame.com": "Fashion & accessories",

  // Food & beverage — food brands, grocery and delivery.
  "bluetokaicoffee.com": "Food & beverage",
  "countrydelight.in": "Food & beverage",
  "epigamia.com": "Food & beverage",
  "oatly.com": "Food & beverage",
  "slurrpfarm.com": "Food & beverage",
  "swiggy.com": "Food & beverage",
  "teabox.com": "Food & beverage",
  "thewholetruthfoods.com": "Food & beverage",
  "thrivemarket.com": "Food & beverage",
  "vahdamteas.com": "Food & beverage",

  // Consumer electronics — gadgets, audio, wearables and tech accessories.
  "ambraneindia.com": "Consumer electronics",
  "boat-lifestyle.com": "Consumer electronics",
  "fireboltt.com": "Consumer electronics",
  "noisefit.com": "Consumer electronics",
  "ouraring.com": "Consumer electronics",
  "portronics.com": "Consumer electronics",
  "zebronics.com": "Consumer electronics",

  // Home & living — home goods and lifestyle products.
  "casper.com": "Home & living",
  "dailyobjects.com": "Home & living",
  "ikea.com": "Home & living",
};

/** The honest fallback bucket for any domain not in BRAND_CATEGORIES. */
export const BRAND_CATEGORY_OTHER = "More brands";

/**
 * Minimum live brands a curated category needs before its /brands/:slug page
 * may ship (issue #3126). A category that resolves for fewer than this many
 * indexable /ads pages would be a near-empty acquisition surface — the kind
 * of one-brand page that made six of seven categories look abandoned. The
 * route 404s below the floor, the sitemap omits the entry, and the hub drops
 * the link — the same removal path the empty-category rule (#1988/#2067)
 * already used, generalized from zero to a real floor. Domains in a thin
 * category still resolve to their honest label here; only the page waits.
 */
export const BRAND_CATEGORY_PAGE_MIN_BRANDS = 3;

/**
 * Category for a brand page domain. Normalizes the same way the brand-name
 * override map does (lowercase, www. stripped) so a cached `www.hm.com` never
 * escapes the map into the "More brands" bucket. Unknown domains degrade to
 * BRAND_CATEGORY_OTHER — never invented.
 */
export function brandCategoryForDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  return BRAND_CATEGORIES[normalized] ?? BRAND_CATEGORY_OTHER;
}

/**
 * Kebab-slug for a category label (issue #2067). Derives the URL slug from
 * the label so the registry (`BRAND_CATEGORIES`) stays the single source of
 * truth — there is no separately-maintained slug map to drift. The label is
 * lowercased and every run of non-`[a-z0-9]` characters (spaces, `&`, dots,
 * apostrophes) collapses to a single `-`, with leading/trailing `-` stripped.
 * This maps the 8 curated labels to exactly the issue's verify slugs:
 *   "Sport & footwear"        -> sport-footwear
 *   "E-commerce"              -> e-commerce
 *   "Beauty & personal care"  -> beauty-personal-care
 *   "SaaS & software"         -> saas-software
 *   "Fashion & accessories"   -> fashion-accessories
 *   "Food & beverage"         -> food-beverage
 *   "Consumer electronics"    -> consumer-electronics
 *   "Home & living"           -> home-living
 * The single `[^a-z0-9]+` run handles `&` together with its surrounding
 * spaces so "Sport & footwear" becomes `sport-footwear` — never a stray
 * double separator (each run collapses to one `-`).
 */
export function brandCategorySlug(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The curated category labels — every distinct value in `BRAND_CATEGORIES`
 * except the `BRAND_CATEGORY_OTHER` fallback ("More brands"). Derived from
 * the registry (no second classification source), deduped, in
 * first-appearance order.
 */
const CURATED_CATEGORY_LABELS: readonly string[] = [
  ...new Set(
    Object.values(BRAND_CATEGORIES).filter(
      (category) => category !== BRAND_CATEGORY_OTHER,
    ),
  ),
];

/**
 * The derived slug list for the curated categories (issue #2067). Excludes
 * "More brands" — the fallback bucket has no landing page, so it must never
 * appear here. The route builder and sitemap both derive their category set
 * from this, so they can never drift from the registry.
 */
export const CURATED_BRAND_CATEGORY_SLUGS: readonly string[] =
  CURATED_CATEGORY_LABELS.map(brandCategorySlug);

/**
 * Resolve a URL slug back to its curated category label (issue #2067).
 * Matches against the slugs derived from the curated labels only — so the
 * "More brands" placeholders and arbitrary slugs resolve to `null` (the
 * route 404s on those).
 */
export function brandCategoryFromSlug(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  for (const label of CURATED_CATEGORY_LABELS) {
    if (brandCategorySlug(label) === normalized) return label;
  }
  return null;
}

/**
 * Group a set of brand records (anything carrying a `domain` field, e.g. the
 * `IndexableAdsLink` shape) into ordered categories for the /brands hub. The
 * first-appearance order of each named category is preserved, with the
 * BRAND_CATEGORY_OTHER bucket always last so the unclassified brands never
 * appear in the middle of the curated ones. Structural typing keeps this
 * helper free of any ImportedAdsLink dependency.
 */
export function groupBrandRecordsByCategory<T extends { domain: string }>(
  records: readonly T[],
): Array<{ category: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const record of records) {
    const category = brandCategoryForDomain(record.domain);
    const list = buckets.get(category) ?? [];
    list.push(record);
    buckets.set(category, list);
  }
  const ordered: string[] = [];
  for (const category of buckets.keys()) {
    if (category !== BRAND_CATEGORY_OTHER) {
      ordered.push(category);
    }
  }
  ordered.sort((a, b) => a.localeCompare(b));
  if (buckets.has(BRAND_CATEGORY_OTHER)) {
    ordered.push(BRAND_CATEGORY_OTHER);
  }
  return ordered.map((category) => ({
    category,
    items: buckets.get(category) ?? [],
  }));
}
