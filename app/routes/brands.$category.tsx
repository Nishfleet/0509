/**
 * /brands/:category — indexable per-category brand landing pages (issue
 * #2067).
 *
 * The /brands hub (issue #1417) groups every indexable /ads/:domain brand
 * page into coarse buyer categories, but each category was only a heading on
 * the hub — no URL of its own, so a "Sport & footwear" buyer landed on the
 * whole hub and could not point at the comparable set. These category pages
 * give each curated category its own indexable URL listing exactly the
 * brands that fall into it — so the cluster is internally connected:
 * hub → category → brand → hub.
 *
 * The link set comes from the SAME sitemap indexability signal the hub and
 * sitemap use (`loadIndexableAdsInternalLinks` → `loadIndexableBrandPageEntries`),
 * so a category page can never list a brand the hub would not show. Unknown
 * slugs and "More brands" (the fallback bucket with no curated landing page)
 * 404, and an empty curated category 404s too (mirror issue #1988).
 * Cache-only — no live provider. Per-brand Ad Aggression Score is enriched
 * from the same cache-only snapshot the /ads/:domain page reads, degrading
 * to an honest `null` on any hiccup — a deferred score renders as "score
 * pending", never a fabricated number. Score enrichment is bounded (a
 * curated category holds at most ~5 brands); one failed snapshot read only
 * defers that one brand's score, never 500s the category page.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { Breadcrumbs, type BreadcrumbCrumb } from "~/components/breadcrumbs";
import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  brandCategorySocialCardUrl,
  canonicalUrl,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { SitemapEntry } from "~/lib/seo";
import {
  brandCategoryForDomain,
  brandCategoryFromSlug,
} from "~/lib/brand-categories";
import {
  indexableAdsLinkFromPath,
  type IndexableAdsLink,
} from "~/lib/ads-internal-links";

/** Hard cap on per-brand score enrichment reads (each is one D1 read). */
const BRAND_CATEGORY_MAX_SCORE_LOOKUPS = 5;

interface BrandCategoryItem {
  domain: string;
  path: string;
  name: string;
  /** Non-demo ad count from the sitemap backing; null when unavailable. */
  adCount: number | null;
  /** Ad Aggression Score 0–100, or null when deferred. */
  score: number | null;
}

interface BrandCategoryLoaderData {
  slug: string;
  label: string;
  /** Newest sitemap lastmod across the category's brands, or null. */
  lastMod: string | null;
  brands: BrandCategoryItem[];
}

/**
 * Build a Map<domain,{adCount,lastmod}> from the sitemap's brand-page
 * entries so each category brand reads its own ad count + freshness without
 * a second source. Only `/ads/` entries count; anything else is ignored.
 */
function brandMetaFromSitemap(
  entries: readonly SitemapEntry[],
): Map<string, { adCount: number | null; lastmod: string | null }> {
  const map = new Map<string, { adCount: number | null; lastmod: string | null }>();
  for (const entry of entries) {
    if (!entry.path.startsWith("/ads/")) continue;
    const domain = entry.path.slice("/ads/".length);
    map.set(domain, {
      adCount: typeof entry.adCount === "number" ? entry.adCount : null,
      lastmod: entry.lastmod ?? null,
    });
  }
  return map;
}

/** The largest ISO date string in a set, or null when there is none. */
function maxDate(dates: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (best === null || date > best) best = date;
  }
  return best;
}

export async function loader({
  context,
  params,
}: LoaderFunctionArgs): Promise<BrandCategoryLoaderData> {
  const label = brandCategoryFromSlug(params.category ?? "");
  if (!label) {
    throw new Response("Not Found", { status: 404 });
  }
  const slug = (params.category ?? "").trim().toLowerCase();

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  // Same indexable brand signal the hub + sitemap both read, so a category
  // page can never drift from what the hub actually lists. One cache-only
  // read; each /ads/:domain entry carries its own ad count + freshness. A
  // D1 hiccup degrades to no entries (never a 500) — the empty-curated-
  // category 404 below then fires, so the page 404s honestly instead of
  // fabricating a list.
  let brandEntries: readonly SitemapEntry[];
  try {
    const { loadIndexableBrandPageEntries } = await import("~/lib/sitemap.server");
    brandEntries = await loadIndexableBrandPageEntries(env);
  } catch (error) {
    console.warn("Brand category brand load failed; rendering empty category.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    brandEntries = [];
  }
  const brandMeta = brandMetaFromSitemap(brandEntries);

  // The links are the brand entries mapped through the exact same
  // indexableAdsLinkFromPath the hub's loadIndexableAdsInternalLinks uses, so
  // a category page links exactly the brands the hub would show — no second
  // D1 read to derive them.
  const links: IndexableAdsLink[] = [];
  for (const entry of brandEntries) {
    const link = indexableAdsLinkFromPath(entry.path);
    if (link) {
      links.push(link);
    }
  }

  const categoryLinks = links.filter(
    (link) => brandCategoryForDomain(link.domain) === label,
  );

  // Empty curated category — nothing to list, so it 404s (mirror #1988)
  // rather than shipping an empty landing page.
  if (categoryLinks.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }

  const lastMod = maxDate(
    categoryLinks.map((link) => brandMeta.get(link.domain)?.lastmod ?? null),
  );

  const { loadBrandPageCacheSnapshot, computeBrandPageAggressionScore } = await import(
    "~/lib/brand-page.server"
  );

  // Bounded: a curated category holds <= ~5 brands, and each score enrichment
  // is one cache-only snapshot read (no live provider). Any hiccup degrades
  // that one brand's score to a deferred `null` — the category page never 500s
  // because a score is unavailable.
  const scoreDomains = new Set(
    categoryLinks.slice(0, BRAND_CATEGORY_MAX_SCORE_LOOKUPS).map((link) => link.domain),
  );

  const brands: BrandCategoryItem[] = [];
  for (const link of categoryLinks) {
    let score: number | null = null;
    if (scoreDomains.has(link.domain)) {
      try {
        const snapshot = await loadBrandPageCacheSnapshot(env, {
          domain: link.domain,
          visitorCountry: "all",
        });
        score = snapshot
          ? computeBrandPageAggressionScore(snapshot.ads)?.score ?? null
          : null;
      } catch (error) {
        console.warn("Brand category score load failed; deferring score.", {
          domain: link.domain,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        score = null;
      }
    }
    brands.push({
      domain: link.domain,
      path: link.path,
      name: link.name,
      adCount: brandMeta.get(link.domain)?.adCount ?? null,
      score,
    });
  }

  return { slug, label, lastMod, brands };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [
      { title: "Brand category | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }

  const { label, slug } = loaderData;
  const title = `${label} competitor Meta ads | Five to Nine`;
  const description = categoryDescriptionFor(loaderData);
  const ogImageAlt = `${label} competitor Meta ads — Five to Nine`;

  return [
    ...publicSeoMeta({
      title,
      description,
      pathname: `/brands/${slug}`,
      ogImageUrl: brandCategorySocialCardUrl(slug),
      ogImageAlt,
    }),
    // links() cannot read route params in this router version, so the
    // canonical ships as a meta-descriptor link (mirror /ads).
    { tagName: "link", rel: "canonical", href: canonicalUrl(`/brands/${slug}`) },
  ];
};

export default function BrandCategoryRoute() {
  const data = useLoaderData<typeof loader>();
  const { label, slug, brands, lastMod } = data;
  const pageTitle = `${label} competitor Meta ads`;
  const breadcrumbItems: BreadcrumbCrumb[] = [
    { name: "Home", pathname: "/" },
    { name: "Brands", pathname: "/brands" },
    { name: label, pathname: `/brands/${slug}` },
  ];
  const brandWord = brands.length === 1 ? "brand" : "brands";

  return (
    <main className="f9-home f9-brands-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: `${label} competitor Meta ads | Five to Nine`,
            description: categoryDescriptionFor(data),
            pathname: `/brands/${slug}`,
            dateModified: lastMod ?? undefined,
          }),
        )}
      />
      <Breadcrumbs items={breadcrumbItems} />
      {brands.length > 0 && (
        <script
          {...jsonLdScriptProps(
            itemListJsonLd(brands.map((brand) => ({ name: brand.name, pathname: brand.path }))),
          )}
        />
      )}
      <MarketingNav />

      <section className="ld-section" aria-labelledby={`brand-category-${slug}-title`}>
        <div className="ld-section-head">
          <span className="ld-kicker">Brand pages by category</span>
          <h1 id={`brand-category-${slug}-title`}>{pageTitle}</h1>
          <p>
            Fresh, indexable Meta ad pages for every {label} competitor we
            track — the same {brands.length} {brandWord} this hub groups
            together. Land on a brand to see its live ad wall, Ad Aggression
            Score, and change feed.
          </p>
          <p>
            <Link to="/brands">Back to all tracked brands</Link>
          </p>
        </div>

        {brands.length === 0 ? (
          <p className="ld-dim">
            No tracked brands in this category right now — browse{" "}
            <Link to="/brands">all tracked brands</Link> instead.
          </p>
        ) : (
          <ul className="ld-brand-list">
            {brands.map((brand) => (
              <li key={brand.domain}>
                <Link to={brand.path}>{brand.name}</Link>
                <span>&nbsp;·&nbsp;{brand.domain}</span>
                <div className="ld-dim">
                  {brand.adCount !== null
                    ? `— ${brand.adCount} ${brand.adCount === 1 ? "ad" : "ads"}`
                    : "— ad count pending"}
                  {brand.score !== null
                    ? ` · Ad Aggression Score ${brand.score}`
                    : " · Ad Aggression Score pending"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MarketingFooter />
    </main>
  );
}

/** Shared category-intent description for the visible copy + JSON-LD. */
function categoryDescriptionFor(data: BrandCategoryLoaderData): string {
  const label = data.label;
  return `See the real Meta ads ${label} competitors are running right now. Browse every tracked ${label} brand ad wall on Five to Nine.`;
}
