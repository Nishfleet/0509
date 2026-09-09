import type { LoaderFunctionArgs } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { serveLlmsFullFeed } from "~/lib/llms-full.server";

/**
 * Public `/llms-full.txt` resource route (issue #2043).
 *
 * Worker intercept in `workers/app.ts` serves this path first (same as
 * `/llms.txt`) so crawlers skip the React Router tree. This loader is the
 * registered non-splat route the sitemap catalog requires — without it,
 * `SITEMAP_PATHS` listing `/llms-full.txt` would only match the `:locale`
 * catch-all, which 404s for unknown locales. Resource-route pattern (React
 * Router v7): loader only, no default export, so the Response is returned
 * as the body instead of being wrapped in the root HTML layout.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = getOptionalCloudflareContext(context)?.env ?? {};
  return serveLlmsFullFeed(env, request);
}
