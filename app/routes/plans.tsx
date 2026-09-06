import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// Legacy alias: plan pricing lives in the homepage #pricing section. Old
// links to /plans (prior emails, bookmarks) resolve there with a 301.
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${url.origin}/#pricing`, 301);
}
