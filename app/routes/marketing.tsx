import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import type { RootLoaderData } from "~/root";

const marketingDescription =
  "Five to Nine tracks competitor ads, offers, landing pages, and category shifts so revenue teams know what to do next.";

export const links: LinksFunction = () => canonicalLinks("/");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Five to Nine | Market intelligence for revenue teams",
    description: marketingDescription,
    pathname: "/",
  });

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");

  return {
    pricingPreview: await previewDodo0509PlanPrices({
      env: getEnv(context),
      request,
    }),
  };
}

const marketStats = [
  { label: "Category moves", value: "14", detail: "since last scan" },
  { label: "Action notes", value: "9", detail: "ready for review" },
  { label: "Open checks", value: "3", detail: "source state visible" },
];

const signalRows = [
  ["Nykaa", "Bundle ladder changed", "Meta library", "Ready"],
  ["boAt", "COD angle removed", "Landing page", "Review"],
  ["Meesho", "Discount hook added", "Creative OCR", "Tracked"],
];

const backboneStats = [
  { value: "4", label: "market lanes watched", detail: "ads, pages, offers, categories" },
  { value: "3", label: "source states separated", detail: "live, cached, degraded" },
  { value: "1", label: "source trail per move", detail: "capture, text, freshness" },
  { value: "05:09", label: "decision scan", detail: "built for morning action" },
];

const signalRays = Array.from({ length: 96 }, (_, index) => {
  const angle = -82 + (index * 164) / 95;
  const length = 36 + ((index * 17) % 42);
  const alpha = 0.2 + ((index * 11) % 40) / 100;
  return { angle, length, alpha };
});

interface LocalPricingPreview {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, { display?: string }>>
    >
  >;
  usageBundles?: Partial<Record<UsageBundleSlug, { display?: string }>>;
}

function priceLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  fallback: string,
) {
  return preview?.prices?.[planId]?.[cycle]?.display || fallback;
}

function hasPrice(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  return Boolean(preview?.prices?.[planId]?.[cycle]?.display);
}

function bundlePriceLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  fallback: string,
) {
  return preview?.usageBundles?.[bundleId]?.display || fallback;
}

function hasBundlePrice(preview: LocalPricingPreview | null, bundleId: UsageBundleSlug) {
  return Boolean(preview?.usageBundles?.[bundleId]?.display);
}

export default function MarketingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const routeData = useLoaderData<typeof loader>();
  const primaryCta = rootData.session ? "/app" : "/auth/signup";
  const primaryLabel = rootData.session ? "Open workspace" : "Start now";
  const [localPricing, setLocalPricing] = useState<LocalPricingPreview | null>(
    routeData.pricingPreview?.available ? routeData.pricingPreview : null,
  );

  useEffect(() => {
    if (localPricing?.available) return undefined;

    let active = true;

    fetch("/api/pricing-preview")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        const preview = value as LocalPricingPreview | null;
        if (active && preview?.available) setLocalPricing(preview);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [localPricing?.available]);

  return (
    <main className="f9-home">
      <header className="f9-nav">
        <div className="f9-container f9-nav-inner">
          <Link className="f9-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <nav className="f9-nav-links" aria-label="Primary">
            <a href="#platform">Products</a>
            <Link to="/search">Search</Link>
            <a href="#platform">Signals</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <nav className="f9-nav-actions" aria-label="Account">
            <Link className="f9-link-arrow" to="/auth/login">
              Sign in
            </Link>
            <Link className="f9-nav-pill" to={primaryCta}>
              {primaryLabel}
            </Link>
          </nav>
        </div>
      </header>

      <section className="f9-hero">
        <div className="f9-gradient" aria-hidden="true" />
        <div className="f9-white-slice" aria-hidden="true" />

        <div className="f9-container f9-hero-layout">
          <div className="f9-hero-copy">
            <Link className="f9-announcement" to="/search">
              <strong>Market pulse 05:09</strong>
              <span>Revenue signal desk is live</span>
              <em aria-hidden="true" />
            </Link>

            <h1>Market intelligence to grow revenue.</h1>

            <p>
              Track competitor ads, offers, landing pages, and creative shifts from one premium workspace. Five to Nine
              turns market evidence into revenue decisions.
            </p>

            <Form className="f9-email-cta" method="get" action={primaryCta}>
              {rootData.session ? (
                <span className="f9-email-state">Workspace ready</span>
              ) : (
                <input aria-label="Work email" name="email" placeholder="Work email" type="email" />
              )}
              <button type="submit">{primaryLabel}</button>
            </Form>
          </div>

          <aside className="f9-product-stage" aria-label="Five to Nine product preview">
            <div className="f9-workspace-panel">
              <div className="f9-workspace-top">
                <strong>Five to Nine</strong>
                <span>Search market moves</span>
              </div>

              <div className="f9-workspace-card f9-wide-card">
                <div>
                  <span>Today</span>
                  <h2>Priority market moves</h2>
                </div>
                <p>05:09 scan</p>
              </div>

              <div className="f9-stat-grid">
                {marketStats.map((stat) => (
                  <div className="f9-workspace-card" key={stat.label}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                    <small>{stat.detail}</small>
                  </div>
                ))}
              </div>

              <div className="f9-chart-card" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>

              <div className="f9-signal-table">
                {signalRows.map(([competitor, change, source, state]) => (
                  <div className="f9-signal-row" key={competitor}>
                    <strong>{competitor}</strong>
                    <span>{change}</span>
                    <small>{source}</small>
                    <em>{state}</em>
                  </div>
                ))}
              </div>
            </div>

            <div className="f9-brief-device">
              <div className="f9-brief-token" aria-hidden="true">
                59
              </div>
              <span>Revenue brief</span>
              <strong>9 moves to consider</strong>
              <p>Nykaa changed bundle angle. boAt removed COD offer. Meesho added discount hook.</p>
              <div>
                <small>Screenshot</small>
                <em>ready</em>
              </div>
              <div>
                <small>HTML</small>
                <em>linked</em>
              </div>
              <div>
                <small>OCR</small>
                <em>matched</em>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="f9-backbone-section" id="platform">
        <div className="f9-container f9-backbone-shell">
          <div className="f9-backbone-heading">
            <span>Revenue signal layer</span>
            <h2>The signal backbone for teams watching market movement.</h2>
          </div>

          <div className="f9-backbone-stats" aria-label="Five to Nine signal model">
            {backboneStats.map((stat) => (
              <article key={stat.label}>
                <div className="f9-stat-line">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
                <p>{stat.detail}</p>
              </article>
            ))}
          </div>

          <div className="f9-signal-visual" aria-label="Market signal map">
            <div className="f9-visual-controls" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="f9-signal-burst" aria-hidden="true">
              {signalRays.map((ray, index) => (
                <i
                  key={`${ray.angle}-${index}`}
                  style={
                    {
                      "--angle": `${ray.angle}deg`,
                      "--length": `${ray.length}%`,
                      "--alpha": ray.alpha,
                    } as CSSProperties
                  }
                />
              ))}
              <div />
            </div>
          </div>
        </div>
      </section>

      <section className="f9-growth-pricing" id="pricing">
        <div className="f9-container">
          <div className="f9-growth-pricing-head">
            <div>
              <span>Commercial access</span>
              <h2>Start with the monitor your team will actually use.</h2>
            </div>

            <div className="f9-pricing-receipt" aria-label="Dodo local pricing">
              <span>Dodo preview</span>
              <strong>Local</strong>
              <p>Buyer currency is served from checkout preview.</p>
            </div>
          </div>

          <p className="f9-growth-pricing-note">
            Prices are loaded from Dodo for the buyer location. No unlimited claims: watchlists,
            collections, digests, Meta beta access, and proof captures all have visible caps.
          </p>

          <div className="f9-commerce-grid">
            {rootData.pricingPlans.map((plan) => {
              const monthlyReady = hasPrice(localPricing, plan.slug, "monthly");
              const yearlyReady = hasPrice(localPricing, plan.slug, "yearly");

              return (
                <article className="f9-commerce-card" key={plan.name}>
                  <span>{plan.name}</span>
                  <h3>{priceLabel(localPricing, plan.slug, "monthly", plan.monthlyLabel)}</h3>
                  <small>{priceLabel(localPricing, plan.slug, "yearly", plan.yearlyLabel)}</small>
                  <p>{plan.detail}</p>
                  <ul className="f9-plan-feature-list">
                    {plan.features?.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  {rootData.session ? (
                    monthlyReady || yearlyReady ? (
                      <div className="f9-plan-actions">
                        {monthlyReady ? (
                          <Form method="post" action="/api/billing/dodo/checkout">
                            <input type="hidden" name="plan" value={plan.slug} />
                            <input type="hidden" name="cycle" value="monthly" />
                            <button type="submit">Start monthly</button>
                          </Form>
                        ) : null}
                        {yearlyReady ? (
                          <Form method="post" action="/api/billing/dodo/checkout">
                            <input type="hidden" name="plan" value={plan.slug} />
                            <input type="hidden" name="cycle" value="yearly" />
                            <button type="submit">Annual</button>
                          </Form>
                        ) : null}
                      </div>
                    ) : (
                      <span className="f9-price-sync">Dodo price syncing</span>
                    )
                  ) : (
                    <Link to={primaryCta}>{primaryLabel}</Link>
                  )}
                </article>
              );
            })}
          </div>

          <div className="f9-usage-bundles" aria-label="Usage bundles">
            <div className="f9-usage-bundles-head">
              <span>Overflow packs</span>
              <p>
                When a workspace has a noisy launch, buy extra proof capacity instead of pretending
                monitoring is unlimited.
              </p>
            </div>
            <div className="f9-usage-bundle-grid">
              {(rootData.usageBundles ?? []).map((bundle) => (
                <article className="f9-usage-bundle-card" key={bundle.slug}>
                  <span>{bundle.creditLabel}</span>
                  <h3>{bundle.name}</h3>
                  <strong>{bundlePriceLabel(localPricing, bundle.slug, bundle.priceLabel)}</strong>
                  <p>{bundle.detail}</p>
                  {rootData.session && hasBundlePrice(localPricing, bundle.slug) ? (
                    <Form method="post" action="/api/billing/dodo/checkout">
                      <input type="hidden" name="bundle" value={bundle.slug} />
                      <button type="submit">Buy pack</button>
                    </Form>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="f9-footer">
        <div className="f9-container">
          <Link className="f9-footer-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark meta="Market intelligence" />
          </Link>
          <p>Five to Nine turns competitor movement into source-aware revenue decisions.</p>
          <nav aria-label="Footer">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
