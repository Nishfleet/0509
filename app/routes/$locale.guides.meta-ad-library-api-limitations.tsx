// Buyer-surface locale guide — `/fr/guides/meta-ad-library-api-limitations`,
// etc. (issue #3127). Re-exports the EN explainer route's meta and component
// as the localised surface; the locale-specific `links` keeps canonical→EN and
// emits the buyer-surface hreflang cluster, matching the #1501 pattern used by
// the other locale buyer-surface routes. The guide is byte-identical English
// copy (canonical→EN), so it is advertised in the locale sitemaps (issue
// #2294) and serves 200 under every buyer-surface locale prefix.
import type { LinksFunction } from "react-router";
import GuideMetaAdLibraryApiLimitationsRoute, { meta } from "./guides.meta-ad-library-api-limitations";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/guides/meta-ad-library-api-limitations"),
  ...buyerSurfaceHreflangLinks("guides/meta-ad-library-api-limitations"),
];

export default GuideMetaAdLibraryApiLimitationsRoute;
