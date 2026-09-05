import type { LoaderFunctionArgs } from "react-router";

import { getEnv } from "~/lib/context.server";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { normalizeBrandPageDomain } from "~/lib/brand-page.server";
import { enforcePublicBrandPageRateLimit } from "~/lib/rate-limit.server";
import { loadOfferTimeline } from "~/lib/offer-timeline.server";
import { offerTimelineChangeTypes } from "~/lib/offer-timeline";
import { canonicalUrl } from "~/lib/seo";

/**
 * Public JSON feed for the per-competitor offer timeline (issue 964).
 *
 * This is the machine-readable distribution the Dataset JSON-LD on
 * `/timeline/:domain` advertises via `distribution`. It lists every dated,
 * proof-backed offer state with its source URL, timestamp, and the type of
 * change (offer, price, CTA, landing-page copy). It is a bounded D1 read only
 * and never triggers live capture, Browser Rendering, or paid work.
 */
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const brand = normalizeBrandPageDomain(params.domain);
  if (!brand) {
    return Response.json({ error: "Not found" }, { status: 404 });
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

  const { entries } = await loadOfferTimeline(env, {
    domain: brand.domain,
    asOf: null,
  });

  const first = entries[0]?.capturedAt ?? null;
  const last = entries[entries.length - 1]?.capturedAt ?? null;

  return Response.json(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: `${brand.displayName} offer timeline`,
      home_page_url: canonicalUrl(`/ads/${brand.domain}`),
      feed_url: canonicalUrl(`/ads/${brand.domain}/timeline`),
      description: `Dated offer states for ${brand.domain}: headline, CTA, and price, with page text and a screenshot when we stored one.`,
      _domain: brand.domain,
      _brandName: brand.displayName,
      _datePublished: first,
      _dateModified: last,
      _license: canonicalUrl("/terms"),
      _count: entries.length,
      items: entries.map((entry) => ({
        id: entry.id,
        url: canonicalUrl(`/ads/${brand.domain}/timeline`) + `#state-${entry.id}`,
        external_url: entry.canonicalUrl,
        date_published: entry.capturedAt,
        title: entry.headline,
        _ctaText: entry.ctaText,
        _priceText: entry.priceText,
        _formPresent: entry.formPresent,
        _screenshotUrl: entry.screenshotHref,
        _pageTextUrl: entry.pageTextHref,
        _changeTypes: offerTimelineChangeTypes(entry.transition),
        _transition: entry.transition,
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
