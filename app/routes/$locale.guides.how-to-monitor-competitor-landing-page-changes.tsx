// Buyer-surface locale guide — `/fr/guides/how-to-monitor-competitor-landing-page-changes`, etc.
// (issue #2888). Re-exports the EN how-to guide route's meta and component as
// the localised surface; the locale-specific `links` keeps canonical→EN and
// emits the buyer-surface hreflang cluster, matching the #1501 pattern used by
// the other locale buyer-surface routes. The guide is byte-identical English
// copy (canonical→EN), so it is advertised in the locale sitemaps (issue
// #2294) and serves 200 under every buyer-surface locale prefix.
import type { LinksFunction } from "react-router";
import GuideHowToMonitorCompetitorLandingPageChangesRoute, { meta } from "./guides.how-to-monitor-competitor-landing-page-changes";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/guides/how-to-monitor-competitor-landing-page-changes"),
  ...buyerSurfaceHreflangLinks("guides/how-to-monitor-competitor-landing-page-changes"),
];

export default GuideHowToMonitorCompetitorLandingPageChangesRoute;
