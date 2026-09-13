// Buyer-surface locale guide — `/fr/guides/can-ChatGPT-monitor-competitor-ads`,
// etc. (issue #3421). Re-exports the EN explainer route's meta and component
// as the localised surface; the locale-specific `links` keeps canonical→EN and
// emits the buyer-surface hreflang cluster, matching the #1501 pattern used by
// the other locale buyer-surface routes. The guide is byte-identical English
// copy (canonical→EN), so it is advertised in the locale sitemaps (issue
// #2294) and serves 200 under every buyer-surface locale prefix. The
// uppercase ChatGPT in the PATH slug is deliberate — only the signup-source
// marker is lowercase.
import type { LinksFunction } from "react-router";
import GuideCanChatGPTMonitorCompetitorAdsRoute, { meta } from "./guides.can-ChatGPT-monitor-competitor-ads";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/guides/can-ChatGPT-monitor-competitor-ads"),
  ...buyerSurfaceHreflangLinks("guides/can-ChatGPT-monitor-competitor-ads"),
];

export default GuideCanChatGPTMonitorCompetitorAdsRoute;
