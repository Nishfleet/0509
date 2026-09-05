import { useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SneakerResaleLanding } from "~/components/sneaker-resale-landing";
import { sneakerResaleMarket } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { canonicalLinks, publicSeoMeta, sneakerResaleHreflangLinks } from "~/lib/seo";

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
  // Cluster cross-links (issue #1547): the live indexable /ads/:domain pages
  // in the sneaker-resale seed list. Cache-only; [] on a sitemap hiccup.
  const { loadSneakerResaleAdsInternalLinks } = await import(
    "~/lib/ads-internal-links.server"
  );
  return { indexableAdsLinks: await loadSneakerResaleAdsInternalLinks(env) };
}

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: COPY.title,
    description: COPY.description,
    pathname: MARKET.pathname,
    ogLocale: MARKET.ogLocale,
  });

export default function SneakerResaleEnglishRoute() {
  const { indexableAdsLinks } = useLoaderData<typeof loader>();
  return <SneakerResaleLanding locale="en" indexableAdsLinks={indexableAdsLinks} />;
}
