import { Form, Link, useLoaderData, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { demoProof } from "~/lib/demo-proof";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import type { RootLoaderData } from "~/root";

const marketingDescription =
  "Five to Nine tracks competitor ads, offers, and landing pages so revenue teams can react before deals move.";
const publicSearchTrialPath = "/search?website=https%3A%2F%2Fnykaa.com";

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
  { label: "Watched sites", value: "3", detail: "sample setup" },
  { label: "Fields checked", value: "4", detail: "headline, CTA, offer, form" },
  { label: "Evidence saved", value: "9", detail: "screenshots and page text" },
];

const signalRows = [
  ["Competitor page", "Visible offer text changed", "Page evidence", "Review"],
  ["Landing page", "CTA changed on destination", "Page evidence", "Review"],
  ["Tracked form", "Lead form appeared", "Page evidence", "Watched"],
];

const backboneStats = [
  { value: "1", label: "competitor website", detail: "turns into a watchlist" },
  { value: "24h", label: "change checks", detail: "visible offers, CTAs, forms" },
  { value: "3", label: "saved evidence", detail: "screenshot, page text, original link" },
  { value: "05:09", label: "morning brief", detail: "what changed and why it matters" },
];

const signalRays = Array.from({ length: 42 }, (_, index) => {
  const angle = -72 + (index * 144) / 41;
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
  const primaryLabel = rootData.session ? "Open account" : "Start now";
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
            <a href="#demo">Demo</a>
            <Link to={publicSearchTrialPath}>Live search</Link>
            <a href="#platform">Products</a>
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
            <Link className="f9-announcement" to={publicSearchTrialPath}>
              <strong>Readiness-gated beta</strong>
              <span>Preview live search before creating an account</span>
              <em aria-hidden="true" />
            </Link>

            <h1>Know when competitors change the offer.</h1>

            <p>
              Enter a competitor website to preview live ads. Create an account when you want Five to Nine
              to save useful examples, watch landing pages, capture evidence, and brief your team when visible
              offer text, CTAs, forms, or onboarding page copy move.
            </p>

            <div className="f9-hero-proof-actions" aria-label="Sample proof before signup">
              <Link to={publicSearchTrialPath}>Try live search</Link>
              <a href="#demo">Review sample proof loop</a>
              <a href="/api/demo-proof?format=markdown">Open markdown proof</a>
            </div>

            <div className="f9-public-status-note" role="note">
              <strong>Launch status: readiness-gated.</strong>
              <span>
                Billing is verified; broad launch stays gated by fresh proof capture, digest delivery,
                and provider canaries.
              </span>
            </div>

            <Form className="f9-email-cta" method="get" action={primaryCta}>
              {rootData.session ? (
                <span className="f9-email-state">Account ready</span>
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
                <span>Competitor watch</span>
              </div>

              <div className="f9-workspace-card f9-wide-card">
                <div>
                  <span>Today</span>
                  <h2>Competitor changes to review</h2>
                </div>
                <p>Evidence captured</p>
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
              <span>Sample brief</span>
              <strong>3 changes to review</strong>
              <p>
                Visible offer text changed. CTA changed on the destination page. A lead form appeared.
              </p>
              <div>
                <small>Screenshot</small>
                <em>ready</em>
              </div>
              <div>
                <small>Page text</small>
                <em>saved</em>
              </div>
              <div>
                <small>Original link</small>
                <em>captured</em>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="f9-backbone-section" id="platform">
        <div className="f9-container f9-backbone-shell">
          <div className="f9-backbone-heading">
            <span>Why teams use it</span>
            <h2>Stop finding out after the sales call.</h2>
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

      <section className="f9-demo-proof-section" id="demo">
        <div className="f9-container f9-demo-proof-layout">
          <div className="f9-demo-proof-copy">
            <span>Sample proof loop</span>
            <h2>See the proof shape before creating an account.</h2>
            <p>
              This is sample data, not the live search result. It shows the buyer moment Five to Nine
              is built around: one competitor, evidence trail, insight summary, digest preview, and export.
            </p>
            <div className="f9-demo-proof-actions">
              <a href="/api/demo-proof">View JSON</a>
              <a href="/api/demo-proof?format=markdown">Markdown proof</a>
            </div>
          </div>

          <div className="f9-demo-proof-board" aria-label="Sample Five to Nine proof trail">
            <article className="f9-demo-competitor-card">
              <span>{demoProof.competitor.market}</span>
              <h3>{demoProof.competitor.name}</h3>
              <p>{demoProof.summary}</p>
            </article>

            <div className="f9-demo-proof-grid">
              <article>
                <span>Proof trail</span>
                <ul>
                  {demoProof.proofTrail.map((item) => (
                    <li key={item.signal}>
                      <strong>{item.signal}</strong>
                      <p>{item.evidence}</p>
                      <em>{item.source}</em>
                    </li>
                  ))}
                </ul>
              </article>

              <article>
                <span>Digest preview</span>
                <h3>{demoProof.digestPreview.subject}</h3>
                <p>{demoProof.digestPreview.recommendedMove}</p>
                <dl>
                  <div>
                    <dt>Priority</dt>
                    <dd>{demoProof.digestPreview.priority}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{demoProof.digestPreview.confidence}</dd>
                  </div>
                </dl>
              </article>
            </div>

            <div className="f9-demo-intel-grid" aria-label="Sample insight depth">
              <article>
                <span>Top hooks</span>
                <ul>
                  {demoProof.insightPreview.topHooks.map((hook) => (
                    <li key={hook}>{hook}</li>
                  ))}
                </ul>
              </article>
              <article>
                <span>Media mix</span>
                <ul>
                  {demoProof.insightPreview.mediaMix.map((item) => (
                    <li key={item.channel}>
                      <strong>{item.channel}</strong>
                      <em>{item.share}</em>
                    </li>
                  ))}
                </ul>
              </article>
              <article>
                <span>Timeline</span>
                <ul>
                  {demoProof.insightPreview.creativeTimeline.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article>
                <span>Slack-ready export</span>
                <p>{demoProof.exports.slackMarkdown}</p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="f9-growth-pricing" id="pricing">
        <div className="f9-container">
          <div className="f9-growth-pricing-head">
            <div>
              <span>Plans</span>
              <h2>Choose the watch depth your team needs.</h2>
            </div>

            <div className="f9-plan-summary-card" aria-label="Pricing summary">
              <span>Recommended launch plan</span>
              <strong>Start with Starter</strong>
              <p>Weekly change briefs, 10 watchlists, and enough checks for a real sales team.</p>
            </div>
          </div>

          <p className="f9-growth-pricing-note">
            Review live search and the sample proof loop first. Paid plans add account-gated competitor research,
            watchlists, page checks, saved collections, and clear caps.
          </p>

          <div className="f9-commerce-grid">
            {rootData.pricingPlans.map((plan) => {
              const monthlyReady = hasPrice(localPricing, plan.slug, "monthly");
              const yearlyReady = hasPrice(localPricing, plan.slug, "yearly");

              return (
                <article
                  className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}
                  key={plan.name}
                >
                  <span>{plan.name}</span>
                  {plan.slug === "starter" ? <em className="f9-plan-badge">Recommended</em> : null}
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
                      <span className="f9-price-sync">Prices loading</span>
                    )
                  ) : (
                    <Link to={primaryCta}>{primaryLabel}</Link>
                  )}
                </article>
              );
            })}
          </div>

          <div className="f9-usage-bundles" aria-label="Extra check packs">
            <div className="f9-usage-bundles-head">
              <span>Extra check capacity</span>
              <p>
                Add page checks for launch weeks or big campaigns without changing the team's
                plan.
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
          <p>Five to Nine helps teams see competitor offer and landing-page changes before the next sales call.</p>
          <nav aria-label="Footer">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
