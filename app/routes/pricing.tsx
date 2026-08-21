import { useRouteLoaderData } from "react-router";
import type { HeadersArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { MarketingNav } from "~/components/marketing-nav";
import { MarketingFooter } from "~/components/marketing-footer";
import { PricingSection } from "~/components/pricing-section";
import { NO_PRICING_PREVIEW, type LocalPricingPreview } from "~/lib/pricing-preview";
import { billingFaqJsonLdEntries, productFaqEntries } from "~/routes/marketing";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { AppEnv } from "~/lib/env.server";
import type { RootLoaderData } from "~/root";

// The /pricing page is the canonical, indexable home of the pricing surface.
// The homepage carries the same plan cards + bundles + FAQ at /#pricing, but
// that anchor is not a separate URL — search and crawlers cannot link to it
// without a fallback to the home page. /pricing publishes the same content
// at a stable URL so the public pricing story is always reachable and never
// returns a 404.

const pricingDescription =
  "Five to Nine plans for competitor change monitoring. Free for one competitor, paid plans add 3–6 hour checks, evidence, Collections, and daily briefs. Prices localize at checkout.";

export const links: LinksFunction = () => canonicalLinks("/pricing");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Plans · Five to Nine",
    description: pricingDescription,
    pathname: "/pricing",
  });

// React Router merges only Set-Cookie from loader responses into the document
// response; every other header needs a route-level `headers` export. Without
// this, the private cache-control set by the SSR-pricing loader would be
// dropped and the worker would stamp the generic public policy on HTML that
// embeds buyer-country prices.
export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

// Same SSR bound the homepage uses, so the two pages share the same
// trade-off: race the Dodo checkout preview up to this bound, degrade to
// the honest checkout-localized fallback when Dodo is slower.
const PRICING_SSR_TIMEOUT_MS = 2500;

async function pricingPreviewWithinBound({
  env,
  request,
}: {
  env: AppEnv;
  request: Request;
}): Promise<LocalPricingPreview | typeof NO_PRICING_PREVIEW> {
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const preview = await Promise.race([
      previewDodo0509PlanPrices({ env, request }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("pricing preview exceeded SSR bound")),
          PRICING_SSR_TIMEOUT_MS,
        );
      }),
    ]);
    return preview.available ? preview : NO_PRICING_PREVIEW;
  } catch {
    return NO_PRICING_PREVIEW;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const env = getEnv(context);
  const commercialLaunch = publicCommercialLaunchSummary(env);
  const pricingPreview = await pricingPreviewWithinBound({ env, request });

  if (pricingPreview.available) {
    // Buyer-country prices are embedded in this HTML, so the response must
    // never be shared-cached: a cached DE/EUR variant would otherwise be
    // served to a US visitor (and vice versa). The worker honors an
    // explicitly-set cache-control on cacheable HTML paths instead of
    // stamping the generic public, max-age=300 policy.
    return Response.json(
      { pricingPreview, commercialLaunch },
      { headers: { "Cache-Control": "private, max-age=300", Vary: "cookie" } },
    );
  }

  return { pricingPreview: NO_PRICING_PREVIEW, commercialLaunch };
}

export default function PricingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const agencySaleOpen = true;
  const primaryCta = rootData.session ? "/app" : "/auth/signup";
  const primaryLabel = rootData.session ? "Open app" : "Create account";

  const structuredFaq = faqPageJsonLd([
    ...productFaqEntries,
    ...billingFaqJsonLdEntries(agencySaleOpen),
  ]);

  return (
    <main className="f9-home">
      <script {...jsonLdScriptProps(structuredFaq)} />

      <MarketingNav />

      <section className="ld-hero">
        <p className="ld-case">
          <span className="ld-rec">Plans</span>
          <span>Pick the monitoring rhythm your team can actually keep up with.</span>
        </p>

        <h1 className="ld-wall ld-wall-compact">
          <span className="ld-row">Pricing built for the</span>
          <span className="ld-row">schedule, not the slide.</span>
        </h1>

        <p className="ld-deck-copy">
          Free: watch 1 competitor with a weekly proof-backed brief. Paid plans add 3–6 hour
          checks, more competitors, Collections, daily briefs, and clear check caps. Prices
          localize at checkout — what you see in your local currency is what you pay.
        </p>

        <p className="ld-pricing-note">
          Questions about fit? Email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll answer honestly,
          including &ldquo;the free plan is enough for you.&rdquo;
        </p>
      </section>

      <PricingSection
        rootData={rootData}
        pricingPreview={null}
        agencySaleOpen={agencySaleOpen}
        variant="compact"
        primaryCta={primaryCta}
        primaryLabel={primaryLabel}
      />

      <MarketingFooter />
    </main>
  );
}
