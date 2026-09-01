// Buyer-surface locale api/docs — `/de/api/docs`, etc. Re-exports the EN
// api.docs route's meta; the locale-specific `links` keeps canonical→/api/docs
// and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import ApiDocsRoute, { meta } from "./api.docs";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/api/docs"),
  ...buyerSurfaceHreflangLinks("api/docs"),
];

export default ApiDocsRoute;
