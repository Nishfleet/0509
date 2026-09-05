// Buyer-surface locale ad-aggression — `/de/ad-aggression`, etc. (issue
// #1578). Re-exports the EN Ad Aggression methodology route's meta and
// component as the localised trust/proof surface; the locale-specific `links`
// keeps canonical→/ad-aggression and emits the buyer-surface hreflang
// cluster. The page's search funnel entry point is locale-aware in
// `./ad-aggression` so a localised buyer stays on the locale-prefixed
// `/search`.
import type { LinksFunction } from "react-router";
import AdAggressionMethodologyRoute, { meta } from "./ad-aggression";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/ad-aggression"),
  ...buyerSurfaceHreflangLinks("ad-aggression"),
];

export default AdAggressionMethodologyRoute;
