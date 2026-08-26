import { useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { SneakerResaleLanding } from "~/components/sneaker-resale-landing";
import {
  isSneakerResaleLocaleId,
  sneakerResaleMarket,
  type SneakerResaleLocaleId,
} from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";
import { canonicalLinks, publicSeoMeta, sneakerResaleHreflangLinks } from "~/lib/seo";

function localeFromParams(params: LoaderFunctionArgs["params"] | { locale?: string }): SneakerResaleLocaleId {
  const locale = params.locale;
  if (!isSneakerResaleLocaleId(locale) || locale === "en") {
    throw new Response("Not Found", { status: 404 });
  }
  return locale;
}

export const links: LinksFunction = ({ params }) => {
  const locale = params.locale;
  if (!isSneakerResaleLocaleId(locale) || locale === "en") {
    return [];
  }
  return [...canonicalLinks(sneakerResaleMarket(locale).pathname), ...sneakerResaleHreflangLinks()];
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const locale = localeFromParams(params);
  const { getEnv } = await import("~/lib/context.server");
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  emitFunnelLocaleSegmentView(getEnv(context), request, locale);
  return { locale };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) {
    return [];
  }
  const market = sneakerResaleMarket(data.locale);
  const copy = sneakerResaleCopy(data.locale);
  return publicSeoMeta({
    title: copy.title,
    description: copy.description,
    pathname: market.pathname,
    ogLocale: market.ogLocale,
  });
};

export default function SneakerResaleLocaleRoute() {
  const { locale } = useLoaderData<typeof loader>();
  return <SneakerResaleLanding locale={locale} />;
}
