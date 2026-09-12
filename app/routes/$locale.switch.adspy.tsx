// Buyer-surface locale switch child — `/de/switch/adspy`, etc. Re-exports the
// EN adspy switch route's meta and component; the locale-specific `links` keeps
// canonical→EN and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import SwitchAdspyRoute, { meta } from "./switch.adspy";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/switch/adspy"),
  ...buyerSurfaceHreflangLinks("switch/adspy"),
];

export default SwitchAdspyRoute;
