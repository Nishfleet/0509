import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// Legacy path from before the 2026-07-20 public-home rebuild, when pricing
// had its own page. The rebuild moved it into the homepage #pricing section
// and every in-app link (nav, CTAs) points at /#pricing. Keep old bookmarks,
// share links, and search-engine hits working with a 301 instead of a 404.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${url.origin}/#pricing`, 301);
}
