/**
 * /brands/:category — indexable, per-category brand landing pages (issue
 * #2067).
 *
 * The /brands hub (`app/routes/brands.tsx`) groups the ~50 indexable
 * /ads/:domain brand pages into 7 curated buyer categories but renders them
 * all inline on ONE route. Category-research wants a dedicated, indexable URL
 * per category so a buyer searching "sport & footwear competitor ads" — or a
 * crawler walking an internal-link graph — lands on a focused page that links
 * every brand in that category. This route serves that surface.
 *
 * It is a thin, cache-only shell over the SAME sitemap indexability signal the
 * hub and the sitemap use (`loadIndexableBrandPageEntries`): the link set can
 * never include a page that would render noindex (demo, stale, empty, or
 * emergency-brake), and the D1 read is bounded — generation never triggers a
 * live provider. Unknown slugs and empty curated groups 404 (mirroring the
 * /ads/:domain empty-guard spirit): a category with no brands has no landing
 * page, so a fictional /brands/<slug> URL must 404 rather than render a shell.
 *
 * Every brand row carries the Ad Aggression Score from the same
 * `computeBrandPageAggressionScore` the /ads/:domain page's loader uses (the
 * sitemap stores it as `SitemapEntry.score`), so the category list shows an
 * honest score or a "pending" line when it is still below the 14-day floor.
 */

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { displayNameFromDomain } from "~/lib/ads-internal-links";
import {
  categoryLabelForSlug,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import {
  brandsCategorySocialCardUrl,
  breadcrumbListJsonLd,
  canonicalUrl,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type SitemapEntry,
} from "~/lib/seo";

/** A brand-page row on a /brands/:category page. */
export interface CategoryBrandItem {
  domain: string;
  path: string;
  name: string;
  /** Number of non-demo ads backing the /ads/:domain page (from the sitemap entry). */
  adCount: number;
  /** Ad Aggression Score (0–100), or null when deferred below the 14-day floor. */
  score: number | null;
}

interface CategoryLoaderData {
  /** The resolved category label (e.g. "Sport & footwear"). */
  category: string;
  /** The slug for this category (e.g. "sport-footwear"), used for card/canonical/JSON-LD. */
  slug: string;
  items: CategoryBrandItem[];
}

/**
 * Pure mapping from the sitemap's indexable /ads/:domain entries to the
 * per-brand row the category page renders. Skips any entry whose path is not a
 * bare `/ads/:domain` (extra segments, query strings) and derives the brand
 * name via the same `displayNameFromDomain` the hub uses, so the category list
 * names brands exactly as their /ads/:domain pages do. Kept pure and exported
 * so the mapping is unit-testable without a database.
 */
export function brandItemsFromSitemapEntries(
  entries: readonly SitemapEntry[],
): CategoryBrandItem[] {
  const items: CategoryBrandItem[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith("/ads/")) {
      continue;
    }
    const domain = entry.path.slice("/ads/".length);
    if (!domain || domain.includes("/") || domain.includes("?") || domain.includes("#")) {
      continue;
    }
    items.push({
      domain,
      path: `/ads/${domain}`,
      name: displayNameFromDomain(domain),
      adCount: entry.adCount ?? 0,
      score: entry.score ?? null,
    });
  }
  return items;
}

export async function loader({ params, context }: LoaderFunctionArgs): Promise<CategoryLoaderData> {
  const normalizedSlug = (params.category ?? "").trim().toLowerCase();
  const category = categoryLabelForSlug(normalizedSlug);
  // An unknown slug (or the hub-only "More brands" bucket — which resolves to
  // null by construction) has no landing page: 404, never render a shell.
  if (!category) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  let entries: SitemapEntry[] = [];
  try {
    const { loadIndexableBrandPageEntries } = await import("~/lib/sitemap.server");
    entries = await loadIndexableBrandPageEntries(env);
  } catch (error) {
    // Mirror the hub's resilience: an index-specialty/loader failure degrades
    // gracefully to an empty list (category below then 404s), never a 500 and
    // never a live-provider fallback.
    console.warn("Category page brand load failed; treating the category as empty.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    entries = [];
  }

  const items = brandItemsFromSitemapEntries(entries);
  const groups = groupBrandRecordsByCategory(items);
  const categoryGroup = groups.find((group) => group.category === category);

  // An empty curated category (no indexable brand currently maps to it) has no
  // page: the issue says omit such a category from the sitemap AND 404 it.
  if (!categoryGroup || categoryGroup.items.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }

  return { category, slug: normalizedSlug, items: categoryGroup.items };
}

/**
 * Category-intent title: "{label} competitor Meta ads | Five to Nine" — the
 * exact query a buyer researching that category would type.
 */
export function brandCategoryTitle(category: string): string {
  return `${category} competitor Meta ads | Five to Nine`;
}

/**
 * Category-intent meta description naming the monitoring offer the page links.
 */
export function brandCategoryDescription(category: string): string {
  return `Track every tracked ${category} brand on Five to Nine: indexable public pages showing the real Meta ads each runs. Free preview, no account needed.`;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [
      { title: "Brand category | Five to Nine" },
      { name: "robots", content: "noindex" },
    ];
  }
  const { category, slug, items } = loaderData;
  const title = brandCategoryTitle(category);
  const description = brandCategoryDescription(category);
  const pathname = `/brands/${slug}`;
  const ogImageUrl = brandsCategorySocialCardUrl(slug);
  return [
    ...publicSeoMeta({
      title,
      description,
      pathname,
      ogImageUrl,
      ogImageAlt: `${category} competitor Meta ads — Five to Nine`,
    }),
    // links() cannot see route params in this router version, so the
    // canonical tag ships as a meta-descriptor link instead (same recipe as
    // /ads/:domain).
    {
      tagName: "link",
      rel: "canonical",
      href: canonicalUrl(pathname),
    },
  ];
};

export default function BrandsCategoryRoute() {
  const data = useLoaderData<typeof loader>();
  const pathname = `/brands/${data.slug}`;
  const items = data.items;

  return (
    <main className="f9-home f9-brands-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: brandCategoryTitle(data.category),
            description: brandCategoryDescription(data.category),
            pathname,
          }),
        )}
      />
      <script
        {...jsonLdScriptProps(
          breadcrumbListJsonLd([
            { name: "Five to Nine", pathname: "/" },
            { name: "Brands", pathname: "/brands" },
            { name: data.category, pathname },
          ]),
        )}
      />
      <script
        {...jsonLdScriptProps(
          itemListJsonLd({
            name: `${data.category} competitor brands`,
            pathname,
            items: items.map((item) => ({
              name: item.name,
              url: canonicalUrl(item.path),
            })),
          }),
        )}
      />
      <MarketingNav />

      <section className="ld-section" aria-labelledby="brand-category-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Public brand pages</span>
          <h1 id="brand-category-title">{data.category} competitor Meta ads</h1>
          <p>
            Every tracked {data.category} brand on Five to Nine — live, indexable
            Meta ad pages with source-linked proof.
          </p>
          <p>
            <Link to="/brands" className="category-back-link">← All brands</Link>
          </p>
        </div>

        <ul className="ld-brand-list">
          {items.map((item) => (
            <li key={item.domain} className="ld-brand-list-item">
              <Link to={item.path}>{item.name}</Link>
              <span className="ld-brand-item-meta">
                &nbsp;·&nbsp;{item.adCount} ad{item.adCount === 1 ? "" : "s"}
                &nbsp;·&nbsp;
                {item.score !== null
                  ? `Ad Aggression Score ${item.score}`
                  : "Ad Aggression Score pending"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <MarketingFooter />
    </main>
  );
}