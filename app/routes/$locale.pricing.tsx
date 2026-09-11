// Buyer-surface locale pricing — `/de/pricing`, etc. Re-exports the EN
// pricing route so the locale page emits the same loader data and the same
// JSON-LD blocks. Prices resolve via the client-side /api/pricing-preview
// fetch, so no buyer-country data is embedded in the HTML and the worker's
// shared public cache policy applies to every locale sibling. The
// locale-specific `links` keeps canonical→/pricing and emits the
// buyer-surface hreflang cluster so every locale sibling declares each
// other.
import type { LinksFunction } from "react-router";
import PricingRoute, { loader, meta } from "./pricing";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { loader, meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/pricing"),
  ...buyerSurfaceHreflangLinks("pricing"),
];

export default PricingRoute;
