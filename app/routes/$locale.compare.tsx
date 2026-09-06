import CompareRoute, { meta } from "./compare";
import type { LinksFunction } from "react-router";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare"),
  ...buyerSurfaceHreflangLinks("compare"),
];

// Compare hub under a locale prefix (`/de/compare`, ...). Re-exports the EN
// hub's meta and component. The EN hub (`compare.tsx`) derives the locale
// prefix from the React Router match chain (`useMatches`) so its child links
// resolve to `/de/compare/<vendor>` instead of the EN `/compare/<vendor>`
// (issue #1563, accept #3) — a non-EN visitor following the index stays in
// the locale rather than falling back to English.
export default function LocaleCompareRoute() {
  return <CompareRoute />;
}
