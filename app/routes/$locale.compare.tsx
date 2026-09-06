import type { LinksFunction } from "react-router";
import CompareRoute, { meta } from "./compare";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare"),
  ...buyerSurfaceHreflangLinks("compare"),
];

// Compare hub under a locale prefix (`/de/compare`, ...). Re-exports the EN
// hub's meta, links contract (canonical→EN + buyer-surface hreflang cluster),
// and component verbatim. No prop may cross this route-module boundary: at
// build time `@react-router/dev` wraps the default export in
// `withComponentProps`, which renders it with only the route props
// (`params`, `loaderData`, `actionData`, `matches`) and silently drops any
// caller-supplied prop — a `localePrefix` prop passed here never reached the
// component in the built app (issue #1563). `compare.tsx` therefore resolves
// the matched `:locale` param via `useParams` internally.
export default CompareRoute;
