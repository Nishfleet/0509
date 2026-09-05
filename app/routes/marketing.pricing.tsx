import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// The homepage pricing section is an anchor (#pricing), not a separate page.
// /pricing is reachable via search engines, prior marketing emails, share
// links, and the sitemap — 301 to the anchor instead of serving the 404 page.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/#pricing${url.search}`, 301);
}
