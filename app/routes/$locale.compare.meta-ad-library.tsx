// Buyer-surface locale compare child — `/de/compare/meta-ad-library`, etc. Re-exports the
// EN meta-ad-library compare route's meta and component so the locale surface stays in
// lockstep with the EN page; the locale-specific `links` keeps canonical→EN
// (so search ranking consolidates on the EN /compare/meta-ad-library, per #1562's
// canonicalisation rule) and emits the buyer-surface hreflang cluster.
import type { LinksFunction } from "react-router";
import CompareMetaAdLibraryRoute, { meta } from "./compare.meta-ad-library";
import { buyerSurfaceHreflangLinks, canonicalLinks } from "~/lib/seo";

export { meta };

export const links: LinksFunction = () => [
  ...canonicalLinks("/compare/meta-ad-library"),
  ...buyerSurfaceHreflangLinks("compare/meta-ad-library"),
];

export default CompareMetaAdLibraryRoute;
