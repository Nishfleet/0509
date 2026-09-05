// Buyer-surface locale pricing — `/de/pricing`, etc. Re-exports the EN
// pricing route so the locale page emits the same cache-control headers
// (buyer-country prices are embedded in the HTML) and the same JSON-LD
// blocks. The locale-specific `links` keeps canonical→/pricing and emits
// the buyer-surface hreflang cluster so every locale sibling declares each
// other.
import type { LinksFunction } from "react-router";
import PricingRoute, { loader, meta, headers } from "./pricing";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { loader, meta, headers };

export const links: LinksFunction = () => [
  ...canonicalLinks("/pricing"),
  ...buyerSurfaceHreflangLinks("pricing"),
];

export default PricingRoute;
