// Buyer-surface locale compare child — `/de/compare/foreplay-spyder`, etc. Re-exports the
// EN foreplay-spyder compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/foreplay-spyder, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareForeplaySpyderRoute, { meta } from "./compare.foreplay-spyder";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/foreplay-spyder"),
  ...buyerSurfaceHreflangLinks("compare/foreplay-spyder"),
];

export default CompareForeplaySpyderRoute;
