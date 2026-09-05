// Buyer-surface locale compare child — `/de/compare/visualping-ad-library`, etc. Re-exports the
// EN visualping-ad-library compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/visualping-ad-library, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareVisualpingAdLibraryRoute, { meta } from "./compare.visualping-ad-library";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/visualping-ad-library"),
  ...buyerSurfaceHreflangLinks("compare/visualping-ad-library"),
];

export default CompareVisualpingAdLibraryRoute;
