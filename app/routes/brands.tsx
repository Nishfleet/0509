/**
 * /brands — the public hub that links to every indexable /ads/:domain brand
 * page (issue #1417).
 *
 * Before this route existed the ~30 sitemap /ads/* pages were orphans: none
 * cross-linked to another /ads page, and no browse page linked them all, so
 * Google discovered each only via the sitemap (no internal link equity) and
 * a buyer who landed on /ads/nike.com could not reach /ads/adidas.com
 * without going back to search. This hub is the browse surface that closes
 * the loop — it lists every indexable brand page, grouped by coarse buyer
 * category so comparable brands sit together. Each /ads/:domain page now
 * cross-links a small "Related brands" set AND this hub, so the whole brand
 * surface is internally linked end to end.
 *
 * The link set comes from the SAME sitemap indexability signal
 * (`loadIndexableAdsInternalLinks` → `loadIndexableBrandPageEntries`) so the
 * hub can never link a page that would render noindex (demo, stale, empty,
 * or emergency-brake). Cache-only read — never triggers a live provider.
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  canonicalLinks,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import {
  brandCategoryFromSlug,
  CURATED_BRAND_CATEGORY_SLUGS,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import "../marketing.css";

/** A brand-page link plus whether its `/timeline/:domain` is indexable. */
interface BrandHubItem extends IndexableAdsLink {
  /** True when the sitemap lists this domain's `/timeline/:domain` (issue #1931). */
  timelineIndexable: boolean;
}

/** A non-empty curated category the hub links to its /brands/:slug page. */
interface BrandCategoryLink {
  slug: string;
  label: string;
  count: number;
}

interface BrandsLoaderData {
  groups: Array<{ category: string; items: BrandHubItem[] }>;
  allCount: number;
  /** Non-empty curated categories, each linking to its /brands/:slug page. */
  categoryLinks: BrandCategoryLink[];
}

export async function loader({ context }: LoaderFunctionArgs): Promise<BrandsLoaderData> {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);

  let links: IndexableAdsLink[] = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    links = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn("Brands hub link load failed; rendering empty hub.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    links = [];
  }

  // Issue #1931 — the hub also links each brand's Offer Timeline when the
  // sitemap lists it, so the moat surface gets in-product distribution from
  // the browse page too. Same indexability signal as the sitemap; a D1
  // hiccup degrades to no timeline links (never a 500).
  let timelineDomains = new Set<string>();
  try {
    const { loadIndexableTimelineDomains } = await import("~/lib/ads-internal-links.server");
    timelineDomains = await loadIndexableTimelineDomains(env);
  } catch (error) {
    console.warn("Brands hub timeline link load failed; omitting timeline links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  const items: BrandHubItem[] = links.map((link) => ({
    ...link,
    timelineIndexable: timelineDomains.has(link.domain),
  }));

  const groups = groupBrandRecordsByCategory(items);

  // Issue #2067 — the hub links each NON-EMPTY curated category to its own
  // /brands/:slug landing page, so the cluster is internally connected
  // (hub → category → brand → hub). The set is derived from the curated slug
  // registry + brandCategoryFromSlug, never hard-coded; a curated category
  // with zero brands today gets no link (its page would 404).
  const categoryLinks: BrandCategoryLink[] = CURATED_BRAND_CATEGORY_SLUGS.flatMap((slug) => {
    const label = brandCategoryFromSlug(slug);
    if (!label) return [];
    const group = groups.find((g) => g.category === label);
    if (!group || group.items.length === 0) return [];
    return [{ slug, label, count: group.items.length }];
  });

  return { groups, allCount: items.length, categoryLinks };
}

const brandsDescription =
  "Browse every brand page on Five to Nine: indexable public pages showing the real Meta ads that run for, or link to, each tracked domain.";

export const links: LinksFunction = () => canonicalLinks("/brands");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Browse all tracked brands | Five to Nine",
    description: brandsDescription,
    pathname: "/brands",
  });

export default function BrandsHubRoute() {
  const data = useLoaderData<typeof loader>();

  // Issue #2215 — the hub is a browsable brand collection, so emit an
  // ItemList with one ListItem per tracked brand, each linking to its
  // /ads/:domain canonical URL. Built from the SAME loader brand list (no
  // new data source) so it can never drift from the visible links. Emitted
  // only when brands are actually listed — an empty hub has nothing to
  // enumerate.
  const allItems = data.groups.flatMap((group) => group.items);
  const itemList =
    allItems.length > 0
      ? itemListJsonLd(allItems.map((item) => ({ name: item.name, pathname: item.path })))
      : null;

  return (
    <main className="f9-home f9-brands-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Browse all tracked brands | Five to Nine",
            description: brandsDescription,
            pathname: "/brands",
          }),
        )}
      />
      {itemList && <script {...jsonLdScriptProps(itemList)} />}
      <MarketingNav />

      <section className="ld-section" aria-labelledby="brands-hub-title">
        <div className="ld-section-head">
          <span className="ld-kicker">Public brand pages</span>
          <h1 id="brands-hub-title">
            {data.allCount > 0
              ? `Browse all ${data.allCount} tracked brands`
              : "Browse tracked brands"}
          </h1>
          <p>
            Fresh, indexable Meta ad pages for every competitor we have on record — the same
            pages the sitemap lists. Land on a brand to see its live ad wall, Ad Aggression
            Score, and change feed.
          </p>
        </div>

        {data.groups.length === 0 ? (
          <p className="ld-dim">
            No brand pages are indexed right now — check the{" "}
            <Link to="/search">live search</Link> to look up a brand&apos;s ads.
          </p>
        ) : (
          <div className="ld-brands-groups">
            {data.groups.map((group) => (
              <section key={group.category} className="ld-brand-group" aria-labelledby={`brand-group-${group.category}`}>
                <h2 id={`brand-group-${group.category}`}>{group.category}</h2>
                <ul className="ld-brand-list">
                  {group.items.map((link) => (
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
              </section>
            ))}
          </div>
        )}

        {data.categoryLinks.length > 0 && (
          <p className="ld-dim ld-browse-categories">
            Browse by category:{" "}
            {data.categoryLinks.map((category, index) => (
              <span key={category.slug}>
                {index > 0 && <span>&nbsp;·&nbsp;</span>}
                <Link to={`/brands/${category.slug}`}>{category.label}</Link>
              </span>
            ))}
          </p>
        )}

        <p className="ld-dim ld-browse-categories">
          {"Scores on these pages come from a published formula — "}
          <Link to={AD_AGGRESSION_METHODOLOGY_PATH}>
            read the Ad Aggression Score methodology
          </Link>
        </p>
      </section>

      <MarketingFooter />
    </main>
  );
}
