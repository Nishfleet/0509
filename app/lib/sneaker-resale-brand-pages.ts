/**
 * Per-brand index pages for the sneaker below-retail cluster (issue #3087).
 *
 * The market-signal run of 2026-09-11 shows the sneaker below-retail cluster
 * persisting at 2 outside sources (the Nike r/stocks thread and the StockX
 * midyear resale report via WWD), while the entire landing surface for it is
 * the single /sneaker-resale hub. Someone searching the demand directly
 * ("nike below retail", "stockx resale trend") had no per-brand page to
 * land on. These pages give each of the four /ads surfaces the cluster
 * already links its own indexable URL, so the cluster is internally
 * connected: hub → brand page → /ads/:domain → hub.
 *
 * Copy rules (issue #3087 acceptance): each page states only what the stored
 * captures and the cited public sources actually show, reusing the
 * sneaker-resale voice and the SAME dated citations the hub publishes
 * (sneakerResaleCopy("en").swingSources is the single source of truth for
 * the source list — the brand pages never maintain their own parallel list
 * so the two can not drift). Pages make no fairness or demand claims the
 * hub does not already make.
 */

import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";

export interface SneakerResaleBrandPageCopy {
  /** URL slug: /sneaker-resale/<slug> */
  slug: string;
  /** Brand display name. */
  name: string;
  /** Registrable domain with a live /ads/:domain page in the cluster. */
  domain: string;
  /** The dated, brand-specific signal line. Facts only. */
  signal: string;
  /** What the stored captures actually back, in the hub's voice. */
  proof: ReadonlyArray<{ title: string; detail: string }>;
}

/**
 * The four brands with live /ads/:domain pages the sneaker-resale hub
 * already links (verified against the production landing page, 2026-09-11):
 * nike.com, stockx.com, footlocker.com, jdsports.com. A brand whose /ads
 * page disappears from the cluster breaks the internal link, so the exact
 * set is pinned by tests/sneaker-resale-brand-pages.route.test.ts.
 */
export const SNEAKER_RESALE_BRAND_PAGE_SLUGS = [
  "nike",
  "stockx",
  "footlocker",
  "jdsports",
] as const;

export type SneakerResaleBrandPageSlug = (typeof SNEAKER_RESALE_BRAND_PAGE_SLUGS)[number];

const BRAND_PAGES: ReadonlyArray<SneakerResaleBrandPageCopy> = [
  {
    slug: "nike",
    name: "Nike",
    domain: "nike.com",
    signal:
      "The below-retail demand for Nike is visible in the market signal right now: the 'Just Don't Wear It' thread on r/stocks — 6,561 upvotes and 1,919 comments, posted 2026-08-30.",
    proof: [
      {
        title: "The Nike ad wall, saved as screenshots.",
        detail:
          "Five to Nine watches nike.com's Meta Ad Library surface and saves every ad and landing page it serves as a screenshot with the original link and a timestamp — so when the offer or the CTA moves, you can put the old one next to the new one.",
      },
      {
        title: "Real captures, real dates.",
        detail:
          "The wall shows what nike.com is actually running in the Meta Ad Library, from real captures. If the wall looks empty, we say so — we never present sample data as a brand's real ads.",
      },
    ],
  },
  {
    slug: "stockx",
    name: "StockX",
    domain: "stockx.com",
    signal:
      "StockX published its own midyear resale report (via WWD, 2026-08-12) — the second live source in the below-retail cluster named by the market signal on 2026-09-11.",
    proof: [
      {
        title: "The StockX ad wall, saved as screenshots.",
        detail:
          "Five to Nine watches stockx.com's Meta Ad Library surface and saves every ad and landing page it serves as a screenshot with the original link and a timestamp — the offer copy you can diff against what it said yesterday.",
      },
      {
        title: "Real captures, real dates.",
        detail:
          "The wall shows what stockx.com is actually running in the Meta Ad Library, from real captures. If the wall looks empty, we say so — we never present sample data as a brand's real ads.",
      },
    ],
  },
  {
    slug: "footlocker",
    name: "Foot Locker",
    domain: "footlocker.com",
    signal:
      "Foot Locker sells the same below-retail market the signal sources name — the r/stocks thread (2026-08-30) and the StockX midyear resale report (WWD, 2026-08-12) — and the article-level demand the signal tracks names the market, not the retailer.",
    proof: [
      {
        title: "The Foot Locker ad wall, saved as screenshots.",
        detail:
          "Five to Nine watches footlocker.com's Meta Ad Library surface and saves every ad and landing page it serves as a screenshot with the original link and a timestamp.",
      },
      {
        title: "Real captures, real dates.",
        detail:
          "The wall shows what footlocker.com is actually running in the Meta Ad Library, from real captures. If the wall looks empty, we say so — we never present sample data as a brand's real ads.",
      },
    ],
  },
  {
    slug: "jdsports",
    name: "JD Sports",
    domain: "jdsports.com",
    signal:
      "JD Sports sells into the same below-retail sneaker market the signal sources name — the r/stocks thread (2026-08-30) and the StockX midyear resale report (WWD, 2026-08-12). The public sources track the market, not the retailer.",
    proof: [
      {
        title: "The JD Sports ad wall, saved as screenshots.",
        detail:
          "Five to Nine watches jdsports.com's Meta Ad Library surface and saves every ad and landing page it serves as a screenshot with the original link and a timestamp.",
      },
      {
        title: "Real captures, real dates.",
        detail:
          "The wall shows what jdsports.com is actually running in the Meta Ad Library, from real captures. If the wall looks empty, we say so — we never present sample data as a brand's real ads.",
      },
    ],
  },
];

/** Look up a brand page by URL slug; undefined for a 404. */
export function sneakerResaleBrandPage(
  slug: string,
): SneakerResaleBrandPageCopy | undefined {
  return BRAND_PAGES.find((page) => page.slug === slug.toLowerCase());
}

/**
 * The dated source list, read from the EN hub copy's swingSources so the
 * brand pages and the hub cite the identical set with identical dates.
 */
export function sneakerResaleBrandSources(): ReadonlyArray<{
  label: string;
  url: string;
  publishedIso: string;
}> {
  return sneakerResaleCopy("en").swingSources;
}

/** The hub's signal publication date (the freshness guard, issue #2856). */
export function sneakerResaleBrandSignalAsOf(): string {
  return sneakerResaleCopy("en").swingAsOfIso;
}

/** Map a cluster /ads domain ("nike.com") to its brand-page slug ("nike"). */
export function sneakerResaleSlugForDomain(domain: string): string {
  return domain.replace(/\.com$/, "").toLowerCase();
}

/** Full local path of a brand page: /sneaker-resale/<slug>. */
export function sneakerResaleBrandPath(slug: string): string {
  return `/sneaker-resale/${slug}`;
}
