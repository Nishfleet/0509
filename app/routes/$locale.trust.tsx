// Buyer-surface locale trust — `/de/trust`, etc. Re-exports the EN trust
// route's meta; the locale-specific `links` keeps canonical→/trust and emits
// the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import TrustRoute, { meta } from "./trust";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/trust"),
  ...buyerSurfaceHreflangLinks("trust"),
];

export default TrustRoute;
