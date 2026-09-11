import { useLoaderData, useRouteLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { TrustProofNote } from "~/components/trust-proof-note";
import { MarketingNav } from "~/components/marketing-nav";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { MarketingFooter } from "~/components/marketing-footer";
import {
  PricingSection,
  billingFaqJsonLdEntries,
} from "~/components/pricing-section";
import type { PublicCommercialLaunchSummary } from "~/lib/commercial-launch-gate.server";
import {
  buyerSurfaceHreflangLinks,
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  pricingOffersJsonLd,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { RootLoaderData } from "~/root";

// Issue #2694: /pricing no longer SSRs buyer-country Dodo prices. The loader
// always returns the "no preview" sentinel and PricingSection fetches the
// existing /api/pricing-preview from the client, so the worker can stamp the
// shared `public, max-age=300` policy on this page.
const noPricingPreview = { available: false } as const;

const pricingTitle = "Pricing | Five to Nine";
const pricingDescription =
  "Competitor monitoring plans: free single-competitor watch, Scout, Starter, and Agency, plus proof capture packs. Prices localize at checkout.";

export const links: LinksFunction = () => [
  ...canonicalLinks("/pricing"),
  ...buyerSurfaceHreflangLinks("pricing"),
];

export const meta: MetaFunction = () =>
  publicSeoMeta({ title: pricingTitle, description: pricingDescription, pathname: "/pricing" });

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);
  const commercialLaunch = publicCommercialLaunchSummary(env);
  // No SSR pricing preview: PricingSection resolves buyer-country prices via
  // the client fetch, so this document stays off the 2.5s SSR bound and the
  // worker's PUBLIC_CACHEABLE_HTML_PATHS policy actually applies.
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
      {/* Issue #2026 + #2049: the buyer-facing "no phantom changes" proof
          element sits one click from the plans — the proof claim a buyer
          evaluating a price is actually weighing — and links to both the
          /no-phantom-changes guarantee and the /capture-rules rule set. */}
      <TrustProofNote />
      <MarketingFooter />
    </main>
  );
}
