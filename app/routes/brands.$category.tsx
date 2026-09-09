/**
 * /brands/:category — indexable per-category landing pages (issue #2067).
 *
 * The /brands hub (#1417) groups every tracked brand into 8 in-page <h2>
 * sections on one flat route. Those sections are not individually indexable:
 * a buyer searching for a category-intent query ("beauty brand competitor
 * ads", "SaaS competitor monitoring") has no dedicated landing page — only the
 * flat /brands hub and the individual /ads/:domain pages. This route splits
 * each curated category section onto its own indexable URL so each can carry
 * its own title/meta, an ItemList schema, a sitemap entry, and a per-category
 * social card.
 *
 * Reuses the SAME indexability signal the /brands hub and the sitemap already
 * use (`loadIndexableAdsInternalLinks` → `loadIndexableBrandPageEntries`) and
 * the SAME classification source (`groupBrandRecordsByCategory` /
 * `BRAND_CATEGORIES` in brand-categories.ts). No new data source, no D1
 * migration, no gate-owned path edits — this is a read over the existing brand
 * records the /brands hub already loads.
 *
 * Empty-category guard (mirrors the /ads empty-guard from issue #1988): a
 * curated category with zero indexable brands 404s and is omitted from the
 * sitemap, so a category page never ships thin. An unknown slug (not one of
 * the curated categories) also 404s — the "More brands" bucket stays on the
 * flat /brands hub (worker's call per the issue; it is the unclassified set,
 * not a category a buyer would search for).
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  brandCategoryFromSlug,
  brandCategorySlug,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import {
  brandsSocialCardUrl,
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  breadcrumbListJsonLd,
  canonicalUrl,
} from "~/lib/seo";

/** A brand-page link plus whether its `/timeline/:domain` is indexable. */
interface BrandCategoryItem extends IndexableAdsLink {
  /** True when the sitemap lists this domain's `/timeline/:domain` (issue #1931). */
  timelineIndexable: boolean;
}

interface BrandCategoryLoaderData {
  category: string;
  slug: string;
  canonicalPath: string;
  items: BrandCategoryItem[];
}

export async function loader({
  context,
  params,
}: LoaderFunctionArgs): Promise<Response | BrandCategoryLoaderData> {
  const slug = (params.category ?? "").trim().toLowerCase();
  const category = brandCategoryFromSlug(slug);
  // Unknown slug or the "More brands" bucket (not a curated category) — 404
  // so an unknown URL never renders a page and never wastes crawl budget.
  if (!category) {
    throw new Response("Unknown brand category", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  let links: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import(
      "~/lib/ads-internal-links.server"
    );
    links = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn("Brand category link load failed; rendering empty category.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    links = [];
  }

  // Issue #1931 — the category page also links each brand's Offer Timeline
  // when the sitemap lists it, same signal as the /brands hub. A D1 hiccup
  // degrades to no timeline links (never a 500).
  let timelineDomains = new Set<string>();
  try {
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    timelineDomains = await loadIndexableTimelineDomains(env);
  } catch (error) {
    console.warn("Brand category timeline link load failed; omitting timeline links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  const items: BrandCategoryItem[] = links.map((link) => ({
    ...link,
    timelineIndexable: timelineDomains.has(link.domain),
  }));

  // groupBrandRecordsByCategory preserves the curated order (alphabetical,
  // "More brands" last); find this category's group.
  const groups = groupBrandRecordsByCategory(items);
  const group = groups.find((g) => g.category === category);

  // Empty-category guard (issue #1988 mirror): a curated category with zero
  // indexable brands 404s and is omitted from the sitemap, so a category page
  // never ships thin content.
  if (!group || group.items.length === 0) {
    throw new Response("No tracked brands in this category yet", { status: 404 });
  }

  const canonicalPath = `/brands/${slug}`;
  return {
    category,
    slug,
    canonicalPath,
    items: group.items,
  };
}

function categoryTitle(category: string): string {
  return `${category} competitor Meta ads | Five to Nine`;
}

function categoryDescription(category: string): string {
  return `Browse every tracked ${category} brand on Five to Nine — indexable public pages showing the real Meta ads that run for each, with Ad Aggression Score and a change feed.`;
}

export const links: LinksFunction = ({ params }) => {
  const slug = (params.category ?? "").trim().toLowerCase();
  if (!brandCategoryFromSlug(slug)) {
    return [];
  }
  return canonicalLinks(`/brands/${slug}`);
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: "Brand category | Five to Nine" }];
  }
  const ogImageUrl = brandsSocialCardUrl(loaderData.slug);
  const ogImageAlt = `${loaderData.category} competitor Meta ads — Five to Nine`;
  return [
    ...publicSeoMeta({
      title: categoryTitle(loaderData.category),
      description: categoryDescription(loaderData.category),
      pathname: loaderData.canonicalPath,
      ogImageUrl,
      ogImageAlt,
    }),
    { tagName: "link", rel: "canonical", href: canonicalUrl(loaderData.canonicalPath) },
  ];
};

/**
 * schema.org ItemList listing the brands in this category. Each entry is a
 * ListItem whose `url` is the brand's indexable /ads/:domain page (the same
 * page the visible list links), so the structured data can never point at a
 * page the sitemap would refuse. Mirrors the directory ItemList shape Google
 * expects for a categorized browse page.
 */
function categoryItemListJsonLd(items: BrandCategoryItem[], pathname: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Tracked brands in this category",
    url: canonicalUrl(pathname),
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: canonicalUrl(item.path),
      name: item.name,
    })),
  } as const;
}

export default function BrandCategoryRoute() {
  const data = useLoaderData<typeof loader>();
  const categoryPath = `/brands/${data.slug}`;

  return (
    <main className="f9-home f9-brands-page f9-brands-category-page">
      <script
        {...jsonLdScriptProps(
          breadcrumbListJsonLd({
            items: [
              { name: "Home", pathname: "/" },
              { name: "Brands", pathname: "/brands" },
              { name: data.category, pathname: categoryPath },
            ],
          }),
        )}
      />
      <script {...jsonLdScriptProps(categoryItemListJsonLd(data.items, categoryPath))} />
      <MarketingNav />

      <section className="ld-section" aria-labelledby="brands-category-title">
        <div className="ld-section-head">
          <p className="ld-breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden="true"> · </span>
            <Link to="/brands">Brands</Link>
            <span aria-hidden="true"> · </span>
            <span>{data.category}</span>
          </p>
          <span className="ld-kicker">Public brand pages</span>
          <h1 id="brands-category-title">
            {data.items.length > 0
              ? `${data.category} competitor Meta ads`
              : data.category}
          </h1>
          <p>
            Fresh, indexable Meta ad pages for every {data.category.toLowerCase()} competitor we
            have on record. Land on a brand to see its live ad wall, Ad Aggression Score, and
            change feed.
          </p>
        </div>

        <ul className="ld-brand-list">
          {data.items.map((link) => (
            <li key={link.domain}>
              <Link to={link.path}>{link.name}</Link>
              <span>&nbsp;·&nbsp;{link.domain}</span>
              {link.timelineIndexable && (
                <>
                  <span>&nbsp;·&nbsp;</span>
                  <Link to={`/timeline/${encodeURIComponent(link.domain)}`}>
                    Offer timeline
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>

        <p className="ld-dim">
          <Link to="/brands">Browse all tracked brands</Link>
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
