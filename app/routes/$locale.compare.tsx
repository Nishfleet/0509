import { useParams } from "react-router";
import type { LinksFunction } from "react-router";
import CompareRoute, { meta } from "./compare";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare"),
  ...buyerSurfaceHreflangLinks("compare"),
];

// Compare hub under a locale prefix (`/de/compare`, ...). Re-exports the EN
// hub's meta and component, and passes the matched locale prefix so the hub's
// child links resolve to `/de/compare/<vendor>` instead of the EN
// `/compare/<vendor>` (issue #1563, accept #3) — a non-EN visitor following
// the index stays in the locale rather than falling back to English.
export default function LocaleCompareRoute() {
  const params = useParams<{ locale?: string }>();
  const localePrefix = params.locale ? `/${params.locale}` : undefined;
  return <CompareRoute localePrefix={localePrefix} />;
}
