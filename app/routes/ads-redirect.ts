import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * /ads — 301 to /brands (issue #2885).
 *
 * The sitemap lists ~75 /ads/:domain children, but the parent /ads path 404'd.
 * /brands is already the live browse index for every indexable /ads/:domain
 * page, so the parent section is a permanent redirect that passes ranking
 * signal to the canonical index per Google's redirect guidance. The query
 * string is preserved so a deep-linked filter survives the hop.
 */
export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  throw redirect(`/brands${search}`, 301);
}
