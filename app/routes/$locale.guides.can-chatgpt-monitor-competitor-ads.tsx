// Buyer-surface locale guide — `/fr/guides/can-chatgpt-monitor-competitor-ads`,
// etc. (issue #3421). Re-exports the EN explainer route's meta and component
// as the localised surface; the locale-specific `links` keeps canonical→EN and
// emits the buyer-surface hreflang cluster, matching the #1501 pattern used by
// the other locale buyer-surface routes. The guide is byte-identical English
// copy (canonical→EN), so it is advertised in the locale sitemaps (issue
// #2294) and serves 200 under every buyer-surface locale prefix. The
// issue-specified slug `/guides/can-ChatGPT-monitor-competitor-ads` stays
// registered verbatim in app/routes.ts and 301s to this lowercase canonical
// under issue #2955 — the canonical and hreflang URLs below must serve 200,
// so they use the lowercase form (pinned by tests/canonical-path.test.ts).
import type { LinksFunction } from "react-router";
import GuideCanChatGPTMonitorCompetitorAdsRoute, { meta } from "./guides.can-chatgpt-monitor-competitor-ads";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/guides/can-chatgpt-monitor-competitor-ads"),
  ...buyerSurfaceHreflangLinks("guides/can-chatgpt-monitor-competitor-ads"),
];

export default GuideCanChatGPTMonitorCompetitorAdsRoute;
