// Buyer-surface locale switch child — `/de/switch/panoramata`, etc. Re-exports the
// EN panoramata switch route's meta and component; the locale-specific `links` keeps
// canonical→EN and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import SwitchPanoramataRoute, { meta } from "./switch.panoramata";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/switch/panoramata"),
  ...buyerSurfaceHreflangLinks("switch/panoramata"),
];

export default SwitchPanoramataRoute;
