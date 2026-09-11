import { redirect } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";

import { COMPARE_CANONICAL_TARGETS, canonicalLinks } from "~/lib/seo";
import CompareVisualpingAdLibrariesRoute, { meta } from "./compare.visualping-ad-libraries";
import "../marketing.css";

export { meta };

// Canonicalized loser (issue #1548, #2085): the plural
// /compare/visualping-ad-libraries is the issue's named winner. This singular
// URL 301-redirects to the plural winner (the /ads alias canonical-redirect
// pattern) so the two identical <title> pages no longer both stay indexable;
// it is dropped from the sitemap so Google consolidates the pair instead of
// splitting equity.
export const links: LinksFunction = () =>
  canonicalLinks(COMPARE_CANONICAL_TARGETS["/compare/visualping-ad-library"]);

export async function loader(_args: LoaderFunctionArgs) {
  throw redirect(
    COMPARE_CANONICAL_TARGETS["/compare/visualping-ad-library"],
    301,
  );
}

export default CompareVisualpingAdLibrariesRoute;
