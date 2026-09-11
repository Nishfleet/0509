/**
 * Splat redirect for the retired untranslated buyer-surface locale cluster
 * (issue #2962, orchestrator decision: Branch B).
 *
 * The untranslated buyer-surface `$locale.*` route cluster (`/de/pricing`,
 * `/fr/compare/panoramata`, `/es/ads/nike.com`, ...) was deleted: every
 * non-sneaker-resale page served byte-identical English copy with
 * `lang="en"` and `canonical → the EN twin`, yet declared hreflang variants
 * in five languages — an audit defect, not a market. The URLs stay reachable
 * for search engines that already indexed them: every buyer-surface locale
 * path now 301s to the SAME pathname without the locale prefix (query
 * preserved verbatim), so no already-indexed URL dead-ends on a 404 and no
 * duplicate is left for Google to consolidate.
 *
 * `/:locale/sneaker-resale` is NOT matched here — it is its own more-specific
 * named route (`routes/$locale.sneaker-resale.tsx`) and React Router v7
 * matches it first: that cluster is genuinely translated (issue #1457/#1460)
 * and keeps its self-canonicals + hreflang. `/de/sitemap.xml` never reaches
 * the router at all (workers/app.ts serves it before the React Router tree).
 *
 * The redirect 301s under the buyer-surface locale allowlist only
 * (`isBuyerSurfaceLocaleId`); any other prefix keeps the pre-existing 404 so
 * an unknown locale can never silently re-route an EN page.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { isBuyerSurfaceLocaleId } from "~/lib/locale-markets";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isBuyerSurfaceLocaleId(locale)) {
    throw new Response("Not Found", { status: 404 });
  }
  const url = new URL(request.url);
  const withoutSuffix = url.pathname.slice(`/${locale}`.length);
  const enPath = withoutSuffix === "" || withoutSuffix === "/" ? "/" : withoutSuffix;
  return redirect(`${enPath}${url.search}`, 301);
}

export default function LocaleRedirect() {
  // The loader always redirects before render, so the component never runs.
  return null;
}
