import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * /briefs — 301 to /briefs/weekly (issue #2885).
 *
 * The sitemap lists /briefs/weekly, but the parent /briefs path 404'd. The
 * weekly brief is the only live brief surface, so the parent is a permanent
 * redirect to it — the cheap correct answer from the issue. The query string
 * is preserved so a deep link survives the hop.
 */
export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  throw redirect(`/briefs/weekly${search}`, 301);
}
