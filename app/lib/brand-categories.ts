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

/**
 * Deterministic kebab-case slug for a category label (issue #2067). `&`
 * becomes a space first so "Beauty & personal care" reads as three words,
 * then every remaining non-alphanumeric run (spaces, hyphens) collapses to
 * a single dash, edge dashes are trimmed, and the result is lowercase. The
 * rule is pure and order-stable so the same registry label always produces
 * the same /brands/:category URL.
 */
function slugifyCategoryLabel(label: string): string {
  return label
    .replace(/&/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The curated /brands/:category landing set (issue #2067), derived from the
 * distinct values of BRAND_CATEGORIES — never a hand-enumerated parallel
 * list — so a registry edit stays single-source: add a domain with a new
 * category label and the category set, its slugs, and its reverse lookup all
 * follow. Sorted alphabetically so the derived order is deterministic.
 * BRAND_CATEGORY_OTHER is excluded by construction: it is not a
 * BRAND_CATEGORIES value, it is the fallback bucket, so it never gets a
 * page or a slug.
 */
const CURATED_CATEGORIES: readonly string[] = Object.freeze(
  [...new Set(Object.values(BRAND_CATEGORIES))].sort((a, b) =>
    a.localeCompare(b),
  ),
);

/** slug → label reverse lookup, derived from the same curated set. */
const CATEGORY_LABEL_BY_SLUG: ReadonlyMap<string, string> = new Map(
  CURATED_CATEGORIES.map((label) => [slugifyCategoryLabel(label), label]),
);

/**
 * The /brands/:category slug for a registry category label. Deterministic —
 * the same label always yields the same slug.
 */
export function categorySlugForLabel(label: string): string {
  return slugifyCategoryLabel(label);
}

/**
 * The category label a /brands/:category slug resolves to, or null when the
 * slug is unknown. The hub-only "More brands" bucket (BRAND_CATEGORY_OTHER)
 * resolves to null like any unknown slug — it has no page by construction,
 * so a /brands/more-brands URL must 404, never render a bucket page.
 */
export function categoryLabelForSlug(slug: string): string | null {
  return CATEGORY_LABEL_BY_SLUG.get(slug) ?? null;
}

/**
 * Slugs of the curated categories, in the same deterministic sorted order as
 * CURATED_CATEGORIES. The route (phase 2) and sitemap builder (phase 4) walk
 * this list instead of hardcoding category URLs, so a registry edit is the
 * only change a new category ever needs.
 */
export function curatedCategorySlugs(): string[] {
  return CURATED_CATEGORIES.map((label) => slugifyCategoryLabel(label));
}
