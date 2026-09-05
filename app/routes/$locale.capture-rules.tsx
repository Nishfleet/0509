// Buyer-surface locale capture-rules — `/de/capture-rules`, etc. (issue 1578).
// Re-exports the EN route's meta and component as the localised
// trust/proof surface that supports the first-value search funnel; the
// locale-specific `links` keeps canonical→/capture-rules and emits the
// buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CaptureRulesRoute, { meta } from "./capture-rules";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/capture-rules"),
  ...buyerSurfaceHreflangLinks("capture-rules"),
];

export default CaptureRulesRoute;
