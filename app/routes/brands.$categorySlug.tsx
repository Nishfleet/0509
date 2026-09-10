/**
 * /brands/:categorySlug — indexable per-category landing pages (issue #2067).
 *
 * The /brands hub (issue #1417) groups all tracked brand pages by a coarse
 * buyer category via `groupBrandRecordsByCategory` and renders 8 category
 * sections as <h2> headings on a single page. Those sections are not
 * individually indexable — they have no per-category meta, canonical,
 * sitemap entry, or URL. This route splits each curated category section
 * onto its own indexable URL so a buyer searching for a category-intent
 * query ("beauty brand competitor ads", "SaaS competitor monitoring") has
 * a dedicated landing page to land on.
 *
 * ZERO-COST CONSTRAINT (same as /brands): the loader reads ONLY from the
 * same sitemap indexability signal (`loadIndexableAdsInternalLinks`) the
 * /brands hub already uses. No D1 migration, no new data source, no live
 * provider call — a public request never triggers discovery or scraping.
 *
 * EMPTY-GUARD: an unknown slug, or a curated category with zero brands,
 * returns a 404 (mirrors the /ads empty-guard from issue #1988). A category
 * page is never shipped empty — there is nothing to enumerate, so it must
 * not be indexable.
 *
 * Reuses the existing `groupBrandRecordsByCategory` + `brand-categories.ts`
 * registry — no new classification source. The category set is the existing
 * 7 curated categories; "More brands" (BRAND_CATEGORY_OTHER) stays on /brands.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { Breadcrumbs } from "~/components/breadcrumbs";
import {
  brandsSocialCardUrl,
  canonicalUrl,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import {
  categoryLabelForSlug,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";

/** A brand-page link plus whether its `/timeline/:domain` is indexable. */
interface BrandCategoryItem extends IndexableAdsLink {
  timelineIndexable: boolean;
}

interface BrandCategoryLoaderData {
  categorySlug: string;
  categoryLabel: string;
  items: BrandCategoryItem[];
}

export async function loader({
  context,
  params,
}: LoaderFunctionArgs): Promise<BrandCategoryLoaderData | Response> {
  const slug = params.categorySlug ?? "";
  const categoryLabel = categoryLabelForSlug(slug);
  // Unknown slug (not a curated category) → 404. "More brands" is not a
  // curated category, so it has no page — it stays on /brands.
  if (!categoryLabel) {
    return new Response("Not Found", { status: 404 });
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
    console.warn("Brands category link load failed; rendering empty.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    links = [];
  }

  // Issue #1931 — same timeline indexability signal as the /brands hub.
  let timelineDomains = new Set<string>();
  try {
    const { loadIndexableTimelineDomains } = await import(
      "~/lib/ads-internal-links.server"
    );
    timelineDomains = await loadIndexableTimelineDomains(env);
  } catch (error) {
    console.warn("Brands category timeline link load failed; omitting timeline links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  const items: BrandCategoryItem[] = links.map((link) => ({
    ...link,
    timelineIndexable: timelineDomains.has(link.domain),
  }));

  // Reuse the SAME grouping the /brands hub uses, then filter to this one
  // category. No new classification source.
  const groups = groupBrandRecordsByCategory(items);
  const group = groups.find((g) => g.category === categoryLabel);

  // Empty-guard (issue #1988 mirror): a curated category with zero brands
  // is never shipped — there is nothing to enumerate, so it must not be
  // indexable. 404 instead of rendering an empty page.
  if (!group || group.items.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  return {
    categorySlug: slug,
    categoryLabel,
    items: group.items,
  };
}

const pathname = (slug: string) => `/brands/${slug}`;

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: "Brand category | Five to Nine" }];
  }
  const title = `${loaderData.categoryLabel} competitor Meta ads | Five to Nine`;
  const description = `Browse every tracked ${loaderData.categoryLabel.toLowerCase()} brand on Five to Nine — indexable public pages showing the real Meta ads that run for, or link to, each domain in this category.`;
  const ogImageUrl = brandsSocialCardUrl(loaderData.categorySlug);
  const ogImageAlt = `${loaderData.categoryLabel} competitor Meta ads — Five to Nine`;
  return [
    ...publicSeoMeta({
      title,
      description,
      pathname: pathname(loaderData.categorySlug),
      ogImageUrl,
      ogImageAlt,
    }),
    // links() cannot see route params in this router version, so the
    // canonical tag ships as a meta-descriptor link instead (same pattern as
    // the /ads/:domain route).
    { tagName: "link", rel: "canonical", href: canonicalUrl(pathname(loaderData.categorySlug)) },
  ];
};

export default function BrandCategoryRoute() {
  const data = useLoaderData<typeof loader>();
  const categoryPath = pathname(data.categorySlug);

  const itemList = itemListJsonLd(
    data.items.map((item) => ({ name: item.name, pathname: item.path })),
  );

  return (
    <main className="f9-home f9-brands-page f9-brands-category-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: `${data.categoryLabel} competitor Meta ads | Five to Nine`,
            description: `Browse every tracked ${data.categoryLabel.toLowerCase()} brand on Five to Nine.`,
            pathname: categoryPath,
          }),
        )}
      />
      <script {...jsonLdScriptProps(itemList)} />
      <MarketingNav />

      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Brands", pathname: "/brands" },
          { name: data.categoryLabel, pathname: categoryPath },
        ]}
      />

      <section className="ld-section" aria-labelledby="brands-category-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Public brand pages</span>
          <h1 id="brands-category-title">
            {data.categoryLabel} competitor ads
          </h1>
          <p>
            Fresh, indexable Meta ad pages for every {data.categoryLabel.toLowerCase()}{" "}
            brand we track — the same pages the sitemap lists. Land on a brand to see its
            live ad wall, Ad Aggression Score, and change feed.
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
