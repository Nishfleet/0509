import { Link } from "react-router";
import { useEffect, useState } from "react";

import {
  DODO_ANNUAL_SAVINGS_LABEL,
  dodoAnnualSavingsIsValid,
  dodoAnnualUnavailableCopy,
} from "~/lib/dodo-pricing-display";
import type { LocalPricingPreview } from "~/lib/pricing-preview";
import type { PricingBillingCycle, PricingPlanSlug } from "~/lib/pricing";
import { EVIDENCE_USAGE_CUSTOMER_COPY } from "~/lib/pricing";
import {
  bundlePriceLabel,
  bundleValueLabel,
  hasBundlePrice,
  hasPrice,
  planIntentPath,
  planValueSummary,
  priceLabel,
  valueMathLabel,
} from "~/lib/pricing-section-helpers";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { RootLoaderData } from "~/root";

export type PricingSectionVariant = "full" | "compact";

export interface PricingSectionProps {
  rootData: RootLoaderData;
  pricingPreview: LocalPricingPreview | null;
  agencySaleOpen: boolean;
  /**
   * "full" — render the kicker headline, summary card, cycle toggle, plan
   * grid, bundles grid, and billing FAQ. The marketing homepage uses this.
   * "compact" — render the same plan grid + bundles + FAQ but skip the
   * hero summary card and the kicker headline. The standalone /pricing
   * route uses this so the page does not double up on the homepage hero.
   */
  variant?: PricingSectionVariant;
  /**
   * The fallback CTA for an anonymous buyer when the plan is not currently
   * buyable. The marketing route uses /auth/signup (or /app when signed in);
   * the /pricing route uses the same value so the two stay in step.
   */
  primaryCta: string;
  primaryLabel: string;
}

/**
 * Pricing section — single source of truth for the plan cards, bundles,
 * proof-capture packs, and billing FAQ. Used by the homepage at /#pricing
 * and the standalone /pricing route. The two pages must stay byte-equivalent
 * in the data they ship, so this component is the only place that markup
 * is defined.
 */
export function PricingSection({
  rootData,
  pricingPreview,
  agencySaleOpen,
  variant = "full",
  primaryCta,
  primaryLabel,
}: PricingSectionProps) {
  const [localPricing, setLocalPricing] = useState<LocalPricingPreview | null>(pricingPreview);
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>("monthly");

  const isPlanSaleOpenFor = (plan: PricingPlanSlug) =>
    plan === "agency" ? agencySaleOpen : true;

  const saleOpenPricingPlans = rootData.pricingPlans.filter((plan) =>
    isPlanSaleOpenFor(plan.slug),
  );
  const annualCycleAvailable =
    saleOpenPricingPlans.length > 0 &&
    saleOpenPricingPlans.some((plan) =>
      dodoAnnualSavingsIsValid(localPricing?.annualValidation?.[plan.slug]),
    );
  const annualSavingsValidated =
    saleOpenPricingPlans.length > 0 &&
    saleOpenPricingPlans.every((plan) =>
      dodoAnnualSavingsIsValid(localPricing?.annualValidation?.[plan.slug]),
    );

  useEffect(() => {
    if (billingCycle === "yearly" && !annualCycleAvailable) {
      setBillingCycle("monthly");
    }
  }, [annualCycleAvailable, billingCycle]);

  // The homepage SSR-pricing loader races the Dodo preview against a 2.5s
  // bound and embeds the result in the HTML. When the SSR loader could not
  // get a preview (timeout or Dodo unavailable), this fallback fetches
  // /api/pricing-preview once the section is near the viewport. The
  // /pricing route keeps the same behavior via the same component.
  useEffect(() => {
    if (localPricing?.available) return undefined;
    if (typeof window === "undefined") return undefined;

    let active = true;
    let started = false;
    let observer: IntersectionObserver | undefined;
    let fallbackTimer = 0;

    const startPricingPreview = () => {
      if (!active || started) return;
      started = true;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
      fetch("/api/pricing-preview")
        .then((response) => (response.ok ? response.json() : null))
        .then((value: unknown) => {
          const preview = value as LocalPricingPreview | null;
          if (active && preview?.available) setLocalPricing(preview);
        })
        .catch(() => {
          if (active) setLocalPricing(null);
        });
    };

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) startPricingPreview();
      },
      { rootMargin: "0px 0px 100% 0px", threshold: 0.01 },
    );
    const pricingSection = document.getElementById("pricing");
    if (pricingSection) observer.observe(pricingSection);

    fallbackTimer = window.setTimeout(startPricingPreview, 10_000);

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
    };
  }, [localPricing?.available]);

  const showHeader = variant === "full";

  return (
    <section className="f9-growth-pricing" id="pricing">
      {showHeader ? (
        <div className="ld-section-head">
          <span className="ld-kicker">Plans</span>
          <h2>Choose the monitoring rhythm your team needs.</h2>
          <div className="ld-plan-summary" aria-label="Pricing summary">
            <span>Recommended launch plan</span>
            <strong>Start with Starter</strong>
            <p>3-hour competitor monitoring for 10 competitors, plus daily and weekly briefs.</p>
          </div>
          <p className="ld-pricing-note">
            Free: watch 1 competitor — instant first scan, a weekly proof-backed brief, and 1
            Collection. No card required. Paid plans add 3–6 hour checks, evidence,
            more competitors, Collections, daily briefs, and clear check caps. Save
            winning ads to collections — and see how long each ad has been running when the Ad Library
            shares dates.
          </p>
          <div className="f9-cycle-toggle" role="group" aria-label="Billing cycle">
            <button
              aria-pressed={billingCycle === "monthly"}
              className={billingCycle === "monthly" ? "is-active" : ""}
              onClick={() => setBillingCycle("monthly")}
              type="button"
            >
              Monthly
            </button>
            <button
              aria-pressed={billingCycle === "yearly"}
              aria-disabled={!annualCycleAvailable}
              className={billingCycle === "yearly" ? "is-active" : ""}
              disabled={!annualCycleAvailable}
              onClick={() => {
                if (annualCycleAvailable) setBillingCycle("yearly");
              }}
              type="button"
            >
              <span>Annual</span>
              {annualSavingsValidated ? (
                <span className="f9-toggle-savings">{DODO_ANNUAL_SAVINGS_LABEL}</span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      <div className="f9-commerce-grid ld-reveal">
        {rootData.pricingPlans.map((plan) => {
          const yearlyReady = hasPrice(localPricing, plan.slug, "yearly");
          const selectedReady = hasPrice(localPricing, plan.slug, billingCycle);
          const annualIsValid = dodoAnnualSavingsIsValid(
            localPricing?.annualValidation?.[plan.slug],
          );
          const planSaleOpen = isPlanSaleOpenFor(plan.slug);
          const selectedAnnualBlocked =
            billingCycle === "yearly" && planSaleOpen && yearlyReady && !annualIsValid;
          const valueLabel = valueMathLabel(
            localPricing,
            plan.slug,
            billingCycle,
            annualIsValid,
          );
          const annualStatusCopy = !planSaleOpen
            ? "Checkout temporarily unavailable"
            : annualIsValid
              ? null
              : yearlyReady
                ? "Annual checkout unavailable. Monthly still works."
                : "Prices load in your local currency at checkout";

          return (
            <article
              className={`f9-commerce-card${plan.slug === "starter" ? " is-recommended" : ""}`}
              key={plan.name}
            >
              <span>{plan.name}</span>
              {plan.slug === "starter" ? <em className="f9-plan-badge">Recommended</em> : null}
              {plan.slug === "agency" && !planSaleOpen ? (
                <em className="f9-plan-note">Account review</em>
              ) : null}
              <h3 className={selectedReady ? undefined : "is-loading-price"}>
                {priceLabel(
                  localPricing,
                  plan.slug,
                  billingCycle,
                  billingCycle === "yearly" ? plan.yearlyLabel : plan.monthlyLabel,
                )}
              </h3>
              <small>
                {billingCycle === "yearly"
                  ? annualIsValid && planSaleOpen
                    ? (
                      <span className="f9-annual-status">
                        <span>Annual billing</span>
                        <strong>{DODO_ANNUAL_SAVINGS_LABEL}</strong>
                      </span>
                    )
                    : annualStatusCopy
                    : annualIsValid && planSaleOpen && hasPrice(localPricing, plan.slug, "yearly")
                      ? `${priceLabel(localPricing, plan.slug, "yearly", plan.yearlyLabel)} annual`
                      : "Billed monthly"}
              </small>
              <div className="f9-plan-value" aria-label={`${plan.name} value summary`}>
                <strong>{planValueSummary(plan.slug)}</strong>
                <span>{valueLabel}</span>
              </div>
              <p>{plan.detail}</p>
              <ul className="f9-plan-feature-list">
                {plan.features?.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {rootData.session ? (
                planSaleOpen && selectedReady && !selectedAnnualBlocked ? (
                  <div className="f9-plan-actions">
                    <Link to={planIntentPath(true, plan.slug, billingCycle)}>
                      Choose {billingCycle === "yearly" ? "annual" : "monthly"}
                    </Link>
                  </div>
                ) : plan.slug === "agency" && !planSaleOpen ? (
                  <p className="f9-price-sync">
                    Agency is available by account review. Email{" "}
                    <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will confirm fit directly.
                  </p>
                ) : selectedAnnualBlocked && yearlyReady ? (
                  <span className="f9-price-sync">
                    {dodoAnnualUnavailableCopy(localPricing?.annualValidation?.[plan.slug])}
                  </span>
                ) : (
                  <span className="f9-price-sync">Prices loading</span>
                )
              ) : (
                plan.slug === "agency" && !planSaleOpen ? (
                  <p className="f9-price-sync">
                    Agency is available by account review. Email{" "}
                    <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
                  </p>
                ) : (
                  <Link to={planSaleOpen && selectedReady && !selectedAnnualBlocked
                    ? planIntentPath(false, plan.slug, billingCycle)
                    : primaryCta}
                  >
                    {planSaleOpen && selectedReady && !selectedAnnualBlocked
                      ? `Choose ${billingCycle === "yearly" ? "annual" : "monthly"}`
                      : primaryLabel}
                  </Link>
                )
              )}
            </article>
          );
        })}
      </div>

      <p className="ld-pricing-note">{EVIDENCE_USAGE_CUSTOMER_COPY}</p>

      <p className="ld-pricing-note">
        Coming from MagicBrief or another tool that&rsquo;s winding down? Your competitor list
        imports as watchlists — see the{" "}
        <Link to="/compare/magicbrief">migration guide</Link>. Collections, boards, analytics
        history, and past evidence are not migrated by Five to Nine — you recreate them with our
        help. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we&rsquo;ll set up your
        watchlists with you, person to person.
      </p>

      <div className="ld-bundles" aria-label="Proof capture packs">
        <div className="ld-bundles-head">
          <span className="ld-kicker">Proof capture packs</span>
          <h3>Extra proof captures when campaigns move fast.</h3>
          <p>
            Add purchased proof captures for busy weeks or big campaigns without changing the
            team&rsquo;s plan. Purchased proof captures never expire and carry over until you
            use them.
          </p>
          <p className="ld-check-pack-note">
            Packs: 500 extra proof captures, 2,000 extra proof captures, or 7,500 extra proof
            captures.
          </p>
        </div>
        <div className="ld-bundle-grid ld-reveal">
          {(rootData.usageBundles ?? []).map((bundle) => (
            <article className="ld-bundle-card" key={bundle.slug}>
              <span className="ld-kicker">{bundle.creditLabel}</span>
              <h3>{bundle.name}</h3>
              <strong>{bundlePriceLabel(localPricing, bundle.slug, bundle.priceLabel)}</strong>
              <span className="ld-bundle-value">
                {bundleValueLabel(localPricing, bundle.slug, bundle.creditQuantity)}
              </span>
              <p>{bundle.detail}</p>
              {rootData.session && hasBundlePrice(localPricing, bundle.slug) ? (
                <Link to="/app/billing?source=top-up#top-ups">Manage packs</Link>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      <div className="ld-pricing-faq ld-reveal" aria-label="Pricing FAQ">
        <span className="ld-kicker">FAQ</span>
        <h3>Common billing questions</h3>
        <dl className="proof-trail-list">
          <div>
            <dt>What uses proof captures?</dt>
            <dd>
              Scheduled scans are included with your plan and never touch your cap. A proof
              capture is used when Five to Nine saves a confirmed change with screenshots,
              page text, and the original link.
            </dd>
          </div>
          <div>
            <dt>Do unused proof captures roll over?</dt>
            <dd>
              Included proof captures reset every month and do not roll over — the caps are
              generous. Purchased proof captures never expire and carry over until you use
              them.
            </dd>
          </div>
          <div>
            <dt>What changes on Agency?</dt>
            <dd>
              Agency includes 75 watchlists, 250 Collections, 2,500 proof captures/month, team
              seats, API/MCP access, client reports, and shared report branding.
            </dd>
          </div>
          <div>
            <dt>{agencySaleOpen ? "How does Agency checkout work?" : "Why is Agency held?"}</dt>
            <dd>
              {agencySaleOpen ? (
                <>
                  Agency checkout is available when pricing loads in your region. Email{" "}
                  <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you want an account review
                  before buying.
                </>
              ) : (
                <>
                  Agency is available by account review. Email{" "}
                  <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will confirm fit
                  directly.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Where do prices come from?</dt>
            <dd>
              Display prices load from Dodo Payments in your local currency at preview time. We
              never hardcode checkout amounts in the app.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
