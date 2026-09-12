// Buyer-surface locale compare child — `/de/compare/gethookd`, etc. Re-exports the
// EN gethookd compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/gethookd, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareGethookdRoute, { meta } from "./compare.gethookd";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

import "~/styles/marketing.css";
export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/gethookd"),
  ...buyerSurfaceHreflangLinks("compare/gethookd"),
];

export default CompareGethookdRoute;
