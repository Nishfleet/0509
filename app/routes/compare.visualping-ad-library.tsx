import type { LinksFunction } from "react-router";

import { COMPARE_CANONICAL_TARGETS, canonicalLinks } from "~/lib/seo";
import CompareVisualpingAdLibrariesRoute, { meta } from "./compare.visualping-ad-libraries";

export { meta };

// Canonicalized loser (issue #1548): the plural /compare/visualping-ad-libraries
// is the issue's named winner. This singular URL stays HTTP 200 (existing
// links and the #1481 canonical references still point here) and canonicalizes
// to the plural winner; it is dropped from the sitemap so Google consolidates
// the pair instead of splitting equity.
export const links: LinksFunction = () =>
  canonicalLinks(COMPARE_CANONICAL_TARGETS["/compare/visualping-ad-library"]);

export default CompareVisualpingAdLibrariesRoute;
