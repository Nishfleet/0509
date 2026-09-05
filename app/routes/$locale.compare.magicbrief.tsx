// Buyer-surface locale compare child — `/de/compare/magicbrief`, etc. Re-exports the
// EN magicbrief compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/magicbrief, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareMagicBriefRoute, { meta } from "./compare.magicbrief";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/magicbrief"),
  ...buyerSurfaceHreflangLinks("compare/magicbrief"),
];

export default CompareMagicBriefRoute;
