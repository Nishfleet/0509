import { useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SneakerResaleLanding } from "~/components/sneaker-resale-landing";
import {
  isSneakerResaleLocaleId,
  sneakerResaleMarket,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { canonicalUrl, publicSeoMeta, sneakerResaleHreflangLinks } from "~/lib/seo";

function localeFromParams(params: LoaderFunctionArgs["params"] | { locale?: string }): SneakerResaleLocaleId {
  const locale = params.locale;
  if (!isSneakerResaleLocaleId(locale) || locale === "en") {
    throw new Response("Not Found", { status: 404 });
  }
  return locale;
}

// links() cannot see route params in this router version, so the
// locale-specific canonical tag ships as a meta-descriptor link instead.
export const links: LinksFunction = () => sneakerResaleHreflangLinks();

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const locale = localeFromParams(params);
  const { getEnv } = await import("~/lib/context.server");
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  emitFunnelLocaleSegmentView(getEnv(context), request, locale);
  return { locale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [];
  }
  const market = sneakerResaleMarket(loaderData.locale);
  const copy = sneakerResaleCopy(loaderData.locale);
  return [
    ...publicSeoMeta({
      title: copy.title,
      description: copy.description,
      pathname: market.pathname,
      ogLocale: market.ogLocale,
    }),
    { tagName: "link", rel: "canonical", href: canonicalUrl(market.pathname) },
  ];
};

export default function SneakerResaleLocaleRoute() {
  const { locale } = useLoaderData<typeof loader>();
  return <SneakerResaleLanding locale={locale} />;
}
