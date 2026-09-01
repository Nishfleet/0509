// Buyer-surface locale help — `/de/help`, etc. Re-exports the EN help
// route's meta; the locale-specific `links` keeps canonical→/help and emits
// the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import HelpRoute, { meta } from "./help";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/help"),
  ...buyerSurfaceHreflangLinks("help"),
];

export default HelpRoute;
