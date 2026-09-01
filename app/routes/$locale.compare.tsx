// Buyer-surface locale compare — `/de/compare`, etc. Re-exports the EN
// compare route's meta; the locale-specific `links` keeps canonical→/compare
// and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareRoute, { meta } from "./compare";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare"),
  ...buyerSurfaceHreflangLinks("compare"),
];

export default CompareRoute;
