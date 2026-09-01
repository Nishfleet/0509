import { Outlet, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  canonicalLinks,
  publicSeoMeta,
} from "~/lib/seo";
import {
  isBuyerSurfaceLocaleId,
  BUYER_SURFACE_PATHS,
  BUYER_SURFACE_LOCALE_IDS,
  canonicalPathnameForLocalePath,
} from "~/lib/locale-markets";
import { htmlLangForPathname } from "~/lib/locale-markets";

export interface LocaleLayoutLoaderData {
  locale: BuyerSurfaceLocaleId;
}

/**
 * Validates the locale param and emits the funnel event for the locale segment.
 * The nested routes receive the locale via useLoaderData.
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isBuyerSurfaceLocaleId(locale)) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  const env = getEnv(context);
  emitFunnelLocaleSegmentView(env, request, locale);

  return { locale } satisfies LocaleLayoutLoaderData;
}

/**
 * Provides hreflang links for the current buyer surface path across all locales.
 * The canonical URL points to the English (x-default) version.
 * The nested route's meta will add the page-specific title/description.
 */
export const links: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) return [];
  
  const locale = loaderData.locale;
  const links: Array<{ rel: string; hrefLang?: string; href: string }> = [];

  // Self-referencing hreflang for this locale
  const currentPath = `/${locale}`;
  links.push({
    rel: "alternate",
    hrefLang: locale,
    href: `https://0509.io${currentPath}`,
  });

  // x-default (English) canonical
  links.push({
    rel: "alternate",
    hrefLang: "x-default",
    href: "https://0509.io/",
  });

  // Other buyer surface locales
  for (const otherLocale of BUYER_SURFACE_LOCALE_IDS) {
    if (otherLocale === locale) continue;
    links.push({
      rel: "alternate",
      hrefLang: otherLocale,
      href: `https://0509.io/${otherLocale}`,
    });
  }

  return links;
};

/**
 * The locale layout wraps all buyer surface routes with the marketing nav/footer
 * and sets the canonical link to the English version of the current page.
 */
export default function LocaleLayout() {
  const { locale } = useLoaderData<typeof loader>();
  
  return (
    <>
      <MarketingNav />
      <Outlet />
      <MarketingFooter />
    </>
  );
}