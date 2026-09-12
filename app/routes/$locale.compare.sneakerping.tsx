// Buyer-surface locale compare child — `/de/compare/sneakerping`, etc. Re-exports the
// EN sneakerping compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/sneakerping, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareSneakerpingRoute, { meta } from "./compare.sneakerping";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/sneakerping"),
  ...buyerSurfaceHreflangLinks("compare/sneakerping"),
];

export default CompareSneakerpingRoute;
