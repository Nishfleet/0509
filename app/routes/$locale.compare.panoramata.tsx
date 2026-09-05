// Buyer-surface locale compare child — `/de/compare/panoramata`, etc. Re-exports the
// EN panoramata compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/panoramata, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import ComparePanoramataRoute, { meta } from "./compare.panoramata";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/panoramata"),
  ...buyerSurfaceHreflangLinks("compare/panoramata"),
];

export default ComparePanoramataRoute;
