// Buyer-surface locale docs — `/de/docs`, etc. Re-exports the EN docs
// route's meta; the locale-specific `links` keeps canonical→/docs and emits
// the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import DocsRoute, { meta } from "./docs";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/docs"),
  ...buyerSurfaceHreflangLinks("docs"),
];

export default DocsRoute;
