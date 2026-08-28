import type { LoaderFunctionArgs } from "react-router";

import { getEnv } from "~/lib/context.server";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { normalizeBrandPageDomain } from "~/lib/brand-page.server";
import { enforcePublicBrandPageRateLimit } from "~/lib/rate-limit.server";
import { loadDomainCaptureFailures } from "~/lib/offer-timeline.server";

/**
 * Public capture-failure list endpoint (issue #1345, accept #3).
 *
 * The `/ads/:domain` loader ships only a server-rendered summary (count,
 * date range, reason) — the full per-entry list is NOT leaked into the
 * loader data. This endpoint serves the per-entry list on demand, fetched
 * by the page's `<details>` expand so a buyer who chooses to see every
 * check gets the full dated record without it being in the initial page
 * payload.
 *
 * Bounded D1 read only; never triggers a live capture. Returns an empty
 * `entries` array on any failure (the page never 500s on this surface).
 */
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const brand = normalizeBrandPageDomain(params.domain);
  if (!brand) {
    return Response.json({ entries: [] }, { status: 404 });
  }

  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);

  const rateLimitResponse = await enforcePublicBrandPageRateLimit(
    request,
    env,
    cloudflare?.ctx,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const failures = await loadDomainCaptureFailures(env, { domain: brand.domain });
  return Response.json(
    {
      entries: failures.map((f) => ({
        id: f.id,
        status: f.status,
        reasonCode: f.reasonCode,
        urlChecked: f.urlChecked,
        checkedAt: f.checkedAt,
      })),
    },
    {
      headers: {
        "cache-control": "public, max-age=60",
        vary: "Accept",
      },
    },
  );
}
