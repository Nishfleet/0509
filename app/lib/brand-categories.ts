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
 * This is a deliberate, small registry — it only classifies domains the
 * product already tracks (the public brand-name overrides + known demo/cache
 * brands), and it is honest: it never guesses a brand. Every domain absent
 * from the map groups under BRAND_CATEGORY_OTHER. The grouping label has no
 * ranking weight — it exists purely so the hub reads as a categorized
 * browse surface instead of one flat list.
 */

/** Coarse buyer categories for the public /brands hub grouping. */
export const BRAND_CATEGORIES: Readonly<Record<string, string>> = {
  "nike.com": "Sport & footwear",
  "adidas.com": "Sport & footwear",
  "allbirds.com": "Sport & footwear",
  "asos.com": "E-commerce",
  "hm.com": "E-commerce",
  "nykaa.com": "Beauty & personal care",
  "sugarcosmetics.com": "Beauty & personal care",
  "mcaffeine.com": "Beauty & personal care",
  "bombayshavingcompany.com": "Beauty & personal care",
  "mamaearth.com": "Beauty & personal care",
  "lenskart.com": "Optical & eyewear",
  "hubspot.com": "SaaS & software",
  "ouraring.com": "Wearables & health",
  "ridgewallet.com": "Wallet & accessories",
};

/** The honest fallback bucket for any domain not in BRAND_CATEGORIES. */
export const BRAND_CATEGORY_OTHER = "More brands";

/**
 * The curated category names — the named buckets the /brands hub groups
 * brands into, excluding the BRAND_CATEGORY_OTHER ("More brands") fallback.
 * Issue #2067 splits these into their own indexable /brands/:category landing
 * pages; the "More brands" bucket stays on the flat /brands hub (worker's
 * call per the issue, and the honest choice — it is the unclassified set, not
 * a category a buyer would search for).
 */
export const CURATED_BRAND_CATEGORIES: readonly string[] = Array.from(
  new Set(Object.values(BRAND_CATEGORIES)),
).sort((a, b) => a.localeCompare(b));

/**
 * Slugify a category name into the URL segment for /brands/:category (issue
 * #2067). Lowercase, ampersands and spaces collapse to single hyphens, every
 * other character is kept as-is so the slug round-trips through
 * `brandCategoryFromSlug` losslessly for the curated set. The curated
 * categories contain only letters, spaces, and `&`, so the slug is stable
 * across renders and crawls.
 */
export function brandCategorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/&/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Reverse map: slug → curated category name, or null when the slug is not one
 * of the curated categories. The /brands/:category route 404s on anything this
 * returns null for, so an unknown slug never renders a page.
 */
const CURATED_CATEGORY_BY_SLUG: Readonly<Record<string, string>> =
  Object.fromEntries(
    CURATED_BRAND_CATEGORIES.map((category) => [brandCategorySlug(category), category]),
  );

export function brandCategoryFromSlug(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return CURATED_CATEGORY_BY_SLUG[normalized] ?? null;
}

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
