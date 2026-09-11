import { useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import {
  SneakerResaleLanding,
  sneakerResaleIndexableTimelineDomains,
} from "~/components/sneaker-resale-landing";
import { sneakerResaleMarket } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { canonicalLinks, clusterSocialCardUrl, publicSeoMeta, sneakerResaleHreflangLinks } from "~/lib/seo";
import "../marketing.css";

const MARKET = sneakerResaleMarket("en");
const COPY = sneakerResaleCopy("en");

export const links: LinksFunction = () => [
  ...canonicalLinks(MARKET.pathname),
  ...sneakerResaleHreflangLinks(),
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  emitFunnelLocaleSegmentView(env, request, "en");

  // Issue #2100 — cross-link the BET 3 offer timeline from the strongest-signal
  // topical page, gated by the same sitemap indexability signal /brands uses
  // so an empty/410 ledger is never linked. A D1 hiccup degrades to no
  // timeline pointers (never a 500).
  let timelineDomains: string[] = [];
  try {
    const { loadIndexableTimelineDomains } = await import("~/lib/ads-internal-links.server");
    timelineDomains = sneakerResaleIndexableTimelineDomains(
      await loadIndexableTimelineDomains(env),
    );
  } catch (error) {
    console.warn("Sneaker-resale timeline link load failed; omitting timeline links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  return { timelineDomains };
}

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: COPY.title,
    description: COPY.description,
    pathname: MARKET.pathname,
    ogLocale: MARKET.ogLocale,
    ogImageUrl: clusterSocialCardUrl("sneaker-resale"),
    ogImageAlt: "Sneaker resale competitor ads — Five to Nine",
  });

export default function SneakerResaleEnglishRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <SneakerResaleLanding locale="en" timelineDomains={data?.timelineDomains ?? []} />
  );
}
