// Buyer-surface locale compare child — `/de/compare/visualping`, etc. Re-exports the
// EN visualping compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/visualping, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareVisualpingRoute, { meta } from "./compare.visualping";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/visualping"),
  ...buyerSurfaceHreflangLinks("compare/visualping"),
];

export default CompareVisualpingRoute;
