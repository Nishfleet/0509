// Buyer-surface locale changelog — `/de/changelog`, etc. Re-exports the EN
// changelog route's meta; the locale-specific `links` keeps
// canonical→/changelog and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import ChangelogRoute, { meta } from "./changelog";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/changelog"),
  ...buyerSurfaceHreflangLinks("changelog"),
];

export default ChangelogRoute;
