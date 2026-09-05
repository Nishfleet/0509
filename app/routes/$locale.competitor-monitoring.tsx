// Buyer-surface locale competitor-monitoring — `/de/competitor-monitoring`,
// etc. (issue 1578). Re-exports the EN route's meta and component; the
// locale-specific `links` keeps canonical→/competitor-monitoring and emits
// the buyer-surface hreflang cluster. The page's search funnel entry points
// are locale-aware in `./competitor-monitoring` so a localised buyer stays on
// the locale-prefixed `/search`.
import type { LinksFunction } from "react-router";
import CompetitorMonitoringRoute, { loader, meta } from "./competitor-monitoring";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { loader, meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/competitor-monitoring"),
  ...buyerSurfaceHreflangLinks("competitor-monitoring"),
];

export default CompetitorMonitoringRoute;
