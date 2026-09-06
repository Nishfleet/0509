// Buyer-surface locale compare child — `/de/compare/spyland`, etc. Re-exports the
// EN spyland compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/spyland, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareSpylandRoute, { meta } from "./compare.spyland";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/spyland"),
  ...buyerSurfaceHreflangLinks("compare/spyland"),
];

export default CompareSpylandRoute;
