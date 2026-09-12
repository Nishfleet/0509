// Buyer-surface locale ad-aggression methodology — `/de/methodology`, etc.
// (issue 1578; canonical kept in lockstep with #2022's /methodology URL).
// Re-exports the EN Ad Aggression methodology route's meta and
// component as the localised trust/proof surface; the locale-specific `links`
// keeps canonical→/methodology and emits the buyer-surface hreflang
// cluster. The page's search funnel entry point is locale-aware in
// `./ad-aggression` so a localised buyer stays on the locale-prefixed
// `/search`.
import type { LinksFunction } from "react-router";
import AdAggressionMethodologyRoute, { meta } from "./methodology";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";
import { AD_AGGRESSION_METHODOLOGY_PATH } from "~/lib/aggression-score";

import "~/styles/marketing.css";
export { meta };

export const links: LinksFunction = () => [
  // Canonical points at the EN methodology page (issue #2871 path).
  ...canonicalLinks(AD_AGGRESSION_METHODOLOGY_PATH),
  ...buyerSurfaceHreflangLinks("methodology"),
];

export default AdAggressionMethodologyRoute;
