// Buyer-surface locale switch child — `/de/switch/magicbrief`, etc. Re-exports the
// EN magicbrief switch route's meta and component; the locale-specific `links` keeps
// canonical→EN and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import SwitchMagicBriefRoute, { meta } from "./switch.magicbrief";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/switch/magicbrief"),
  ...buyerSurfaceHreflangLinks("switch/magicbrief"),
];

export default SwitchMagicBriefRoute;
