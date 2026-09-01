// Buyer-surface locale index — `/de`, `/ja`, `/pt-br`, `/fr`, `/es`. Renders
// the exact English marketing page so the locale cluster stays in lockstep
// with the EN surface (issue #1501, accept #2: canonical→EN so duplicate
// content does not fragment search ranking; the locale page ships the same
// content with a locale lang tag).
import type { LinksFunction } from "react-router";
import MarketingRoute, { loader, meta } from "./marketing";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { loader, meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/"),
  ...buyerSurfaceHreflangLinks(""),
];

export default MarketingRoute;
