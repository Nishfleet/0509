// Buyer-surface locale switch child — `/de/switch/visualping`, etc. Re-exports the
// EN visualping switch route's meta and component; the locale-specific `links` keeps
// canonical→EN and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import SwitchVisualpingRoute, { meta } from "./switch.visualping";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/switch/visualping"),
  ...buyerSurfaceHreflangLinks("switch/visualping"),
];

export default SwitchVisualpingRoute;
