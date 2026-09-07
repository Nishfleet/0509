import { useLoaderData, useRouteLoaderData } from "react-router";
import type { HeadersArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  PricingSection,
  billingFaqJsonLdEntries,
} from "~/components/pricing-section";
import type { PublicCommercialLaunchSummary } from "~/lib/commercial-launch-gate.server";
import { noPricingPreview, pricingPreviewWithinBound } from "~/lib/pricing-preview.server";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  pricingOffersJsonLd,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { RootLoaderData } from "~/root";

const pricingTitle = "Pricing | Five to Nine";
const pricingDescription =
  "Competitor monitoring plans: free single-competitor watch, Scout, Starter, and Agency, plus proof capture packs. Prices localize at checkout.";

export const links: LinksFunction = () => canonicalLinks("/pricing");

// Same reason as marketing.tsx: React Router only merges Set-Cookie from loader
// responses into the document; without a headers export the private
// cache-control carrying buyer-country prices would be dropped.
export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

export const meta: MetaFunction = () =>
  publicSeoMeta({ title: pricingTitle, description: pricingDescription, pathname: "/pricing" });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);
  const commercialLaunch = publicCommercialLaunchSummary(env);
  const pricingPreview = await pricingPreviewWithinBound({ env, request });

  if (pricingPreview.available) {
    // Buyer-country prices embedded → browser-only caching, same as home.
    return Response.json(
      { pricingPreview, commercialLaunch },
      { headers: { "Cache-Control": "private, max-age=300", Vary: "cookie" } },
    );
  }
  return { pricingPreview: noPricingPreview, commercialLaunch };
}

export default function PricingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  void rootData; // root data reaches PricingSection via useRouteLoaderData there
  const routeData = useLoaderData<typeof loader>();
  const commercialLaunch: PublicCommercialLaunchSummary = routeData.commercialLaunch ?? {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };

  const structuredOffers = pricingOffersJsonLd();

  return (
    <main className="f9-home">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({ name: pricingTitle, description: pricingDescription, pathname: "/pricing" }),
        )}
      />
      <script
        {...jsonLdScriptProps(faqPageJsonLd(billingFaqJsonLdEntries(commercialLaunch.agencySaleOpen)))}
      />
      <script
        {...jsonLdScriptProps(
          {
            "@context": "https://schema.org",
            "@graph": structuredOffers,
          },
        )}
      />
      <MarketingNav />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Pricing", pathname: "/pricing" },
        ]}
      />
      <PricingSection
        headingLevel="h1"
        commercialLaunch={commercialLaunch}
        initialPricingPreview={routeData.pricingPreview?.available ? routeData.pricingPreview : null}
      />
      <MarketingFooter />
    </main>
  );
}
