// Buyer-surface locale compare child — `/de/compare/foreplay`, etc. Re-exports the
// EN foreplay compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/foreplay, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareForeplayRoute, { meta } from "./compare.foreplay";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/foreplay"),
  ...buyerSurfaceHreflangLinks("compare/foreplay"),
];

export default CompareForeplayRoute;
