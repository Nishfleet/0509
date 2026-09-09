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
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { groupBrandRecordsByCategory, categoryLabelForSlug, categorySlugForLabel } from "~/lib/brand-categories";
import type { IndexableAdsLink } from "~/lib/ads-internal-links";

/** A brand-page link plus whether its `/timeline/:domain` is indexable. */
interface BrandHubItem extends IndexableAdsLink {
  /** True when the sitemap lists this domain's `/timeline/:domain` (issue #1931). */
  timelineIndexable: boolean;
}

interface BrandsLoaderData {
  groups: Array<{ category: string; items: BrandHubItem[] }>;
  allCount: number;
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
  return { groups, allCount: items.length };
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
            {data.groups.map((group) => {
              // Issue #2067 — each curated group's heading links to its own
              // /brands/:category landing page so the hub internally connects
              // to every category surface (and crawlers can follow the graph
              // from the hub to each category to the /ads/:domain pages). The
              // hub-only "More brands" bucket has no page, so its heading
              // stays a plain string — never a link to /brands/more-brands.
              const categorySlug = categorySlugForLabel(group.category);
              const hasCategoryPage = categoryLabelForSlug(categorySlug) === group.category;
              return (
                <section key={group.category} className="ld-brand-group" aria-labelledby={`brand-group-${group.category}`}>
                  <h2 id={`brand-group-${group.category}`}>
                    {hasCategoryPage ? (
                      <Link to={`/brands/${categorySlug}`}>{group.category}</Link>
                    ) : (
                      group.category
                    )}
                  </h2>
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
              );
            })}
          </div>
        )}
      </section>

      <MarketingFooter />
    </main>
  );
}
