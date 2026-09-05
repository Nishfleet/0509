// Buyer-surface locale compare child — `/de/compare/adspyder`, etc. Re-exports the
// EN adspyder compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/adspyder, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareAdspyderRoute, { meta } from "./compare.adspyder";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/adspyder"),
  ...buyerSurfaceHreflangLinks("compare/adspyder"),
];

export default CompareAdspyderRoute;
