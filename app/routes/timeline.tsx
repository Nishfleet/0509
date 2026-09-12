/**
 * /timeline — the index of the /timeline/:domain Offer Timeline section
 * (issue #2885).
 *
 * The sitemap lists ~77 /timeline/:domain pages, but the parent /timeline
 * path 404'd: a crawler or reader who climbed one level up from a timeline
 * hit a dead end. This hub renders a thin listing of the domains that have
 * at least one recorded offer state — the SAME capture-qualified,
 * non-empty set `loadIndexableTimelineEntries` feeds the sitemap, so every
 * domain listed here is guaranteed to be in the sitemap (the inverse is
 * not claimed: the sitemap additionally lists the collecting cohort via
 * `timelineSitemapEntries`, which this index does not re-read). That gate
 * is issue #2881's non-empty rule, reused verbatim.
 *
 * ZERO-COST CONSTRAINT (mirrors /timeline/:domain): the page reads stored
 * `landing_page_snapshot` rows only and never triggers live scraping or any
 * paid operation. The collecting cohort (tracked brands whose timeline has
 * no capture yet — issue #2021) links to /brands, which is the browse index
 * for the whole tracked set.
 */

import { Link, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import { getEnv } from "~/lib/context.server";
import { loadIndexableTimelineEntries } from "~/lib/sitemap.server";
import {
  canonicalLinks,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
} from "~/lib/seo";

const PATHNAME = "/timeline";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Offer Timelines by competitor | Five to Nine",
    description:
      "Every tracked competitor with a recorded offer history: browse each brand's dated offer timeline, built from stored captures — no live scraping.",
    pathname: PATHNAME,
  });

interface TimelineIndexLoaderData {
  domains: Array<{ domain: string; lastmod?: string }>;
  degraded: boolean;
}

export async function loader({
  context,
}: LoaderFunctionArgs): Promise<TimelineIndexLoaderData> {
  const env = getEnv(context);
  try {
    const entries = await loadIndexableTimelineEntries(env);
    return {
      domains: entries.map((entry) => ({
        domain: entry.path.slice("/timeline/".length),
        ...(entry.lastmod ? { lastmod: entry.lastmod } : {}),
      })),
      degraded: false,
    };
  } catch {
    // Degrade to an honest empty index — never a 500 on a public page.
    return { domains: [], degraded: true };
  }
}

export default function TimelineIndex() {
  const { domains, degraded } = useLoaderData<TimelineIndexLoaderData>();
  // ItemList JSON-LD is capped at 100 entries (Google's practical ItemList
  // guidance) while the visible list renders all domains — the structured
  // data is a representative sample, the page is the full index.
  const itemListJsonLdValue = itemListJsonLd(
    domains.slice(0, 100).map((item) => ({
      name: item.domain,
      pathname: `/timeline/${item.domain}`,
    })),
  );
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <script {...jsonLdScriptProps(itemListJsonLdValue)} />
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Offer Timelines</h1>
        <p className="mt-3 text-neutral-600">
          Dated offer histories for tracked competitors, built from stored
          captures. Tracked brands whose timeline has no captures yet are on
          the <Link to="/brands" className="underline">brands index</Link>.
        </p>
        {degraded ? (
          <p className="mt-10 text-sm text-neutral-500">
            The timeline index is briefly offline. Please refresh in a moment.
          </p>
        ) : domains.length === 0 ? (
          <p className="mt-10 text-sm text-neutral-500">
            No offer timelines have recorded states yet.
          </p>
        ) : (
          <ul className="mt-10 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {domains.map((item) => (
              <li key={item.domain}>
                <Link
                  to={`/timeline/${item.domain}`}
                  className="text-neutral-900 underline decoration-neutral-300 hover:decoration-neutral-900"
                >
                  {item.domain}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
