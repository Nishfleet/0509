import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import MarketingRoute from "~/routes/marketing";
import {
  canonicalUrl,
  publicSeoMeta,
} from "~/lib/seo";
import { isBuyerSurfaceLocaleId, canonicalPathnameForLocalePath } from "~/lib/locale-markets";

// Re-use the exact same loader logic as marketing.tsx but add locale validation
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isBuyerSurfaceLocaleId(locale)) {
    throw new Response("Not Found", { status: 404 });
  }

  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const { emitFunnelLocaleSegmentView } = await import("~/lib/funnel-measurement.server");
  const env = getEnv(context);
  emitFunnelLocaleSegmentView(env, request, locale);
  const commercialLaunch = publicCommercialLaunchSummary(env);
  const { pricingPreviewWithinBound, noPricingPreview } = await import("~/lib/pricing-preview.server");
  const pricingPreview = await pricingPreviewWithinBound({ env, request });

  let proofBrief: Awaited<ReturnType<typeof import("~/lib/public-proof.server").loadPublicProofBrief>> | null = null;
  try {
    const { loadPublicProofBrief } = await import("~/lib/public-proof.server");
    proofBrief = await loadPublicProofBrief(env);
  } catch (error) {
    console.warn("Homepage proof brief load failed; rendering the honest state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    proofBrief = null;
  }

  let indexableAdsLinks: Awaited<ReturnType<typeof import("~/lib/ads-internal-links.server").loadIndexableAdsInternalLinks>> = [];
  try {
    const { loadIndexableAdsInternalLinks } = await import("~/lib/ads-internal-links.server");
    indexableAdsLinks = await loadIndexableAdsInternalLinks(env);
  } catch (error) {
    console.warn("Homepage indexable ads links load failed; omitting /ads links.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    indexableAdsLinks = [];
  }

  const data = {
    pricingPreview: pricingPreview.available ? pricingPreview : noPricingPreview,
    commercialLaunch,
    proofBrief,
    indexableAdsLinks,
    locale,
  };

  if (pricingPreview.available) {
    return Response.json(data, { headers: { "Cache-Control": "private, max-age=300", Vary: "cookie" } });
  }

  return data;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) return [];
  const locale = loaderData.locale;
  const canonicalPath = canonicalPathnameForLocalePath(`/${locale}/`);
  return publicSeoMeta({
    title: "Five to Nine | Know when competitors change the offer",
    description:
      "Five to Nine watches competitors' landing pages for price, offer, and CTA changes, then files source-linked proof and change alerts before your next meeting.",
    pathname: canonicalPath,
  });
};

export const links = ({ loaderData }: { loaderData: { locale: string } | undefined }) => {
  if (!loaderData) return [];
  const locale = loaderData.locale;
  const canonicalPath = canonicalPathnameForLocalePath(`/${locale}/`);
  return [{ rel: "canonical", href: canonicalUrl(canonicalPath) }];
};

// Render the exact same component as the English route
export default function LocaleIndexRoute() {
  return <MarketingRoute />;
}