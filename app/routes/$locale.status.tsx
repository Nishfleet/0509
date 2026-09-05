// Buyer-surface locale status — `/de/status`, etc. Re-exports the EN
// status route's loader/meta; the locale-specific `links` keeps
// canonical→/status and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import StatusRoute, { loader, meta } from "./status";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { loader, meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/status"),
  ...buyerSurfaceHreflangLinks("status"),
];

export default StatusRoute;
