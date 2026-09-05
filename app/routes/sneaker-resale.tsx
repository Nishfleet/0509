import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SneakerResaleLanding } from "~/components/sneaker-resale-landing";
import { sneakerResaleMarket } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { canonicalLinks, clusterSocialCardUrl, publicSeoMeta, sneakerResaleHreflangLinks } from "~/lib/seo";

const MARKET = sneakerResaleMarket("en");
const COPY = sneakerResaleCopy("en");

export const links: LinksFunction = () => [
  ...canonicalLinks(MARKET.pathname),
  ...sneakerResaleHreflangLinks(),
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  emitFunnelLocaleSegmentView(getEnv(context), request, "en");
  return null;
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
  return <SneakerResaleLanding locale="en" />;
}
