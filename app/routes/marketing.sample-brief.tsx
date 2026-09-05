import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// The homepage's sample brief is an anchor section (#demo), not a separate
// page. Old marketing emails, share links, and the sitemap still point at
// /sample-brief — 301 to the anchor so the route never serves the 404 page.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/#demo${url.search}`, 301);
}
