import { Link, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";

import {
  DODO_ANNUAL_SAVINGS_LABEL,
  dodoAnnualSavingsIsValid,
  dodoAnnualUnavailableCopy,
} from "~/lib/dodo-pricing-display";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";
import { EVIDENCE_USAGE_CUSTOMER_COPY } from "~/lib/pricing";
import type { FaqJsonLdEntry } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { PublicCommercialLaunchSummary } from "~/lib/commercial-launch-gate.server";
import type { RootLoaderData } from "~/root";

type LocalDisplayPrice = {
  amount?: number | null;
  currency?: string | null;
  display?: string | null;
  validationAmount?: number | null;
};

type LocalAnnualValidation = {
  annualAmount?: number | null;
  billingCountry?: string | null;
  currency?: string | null;
  expectedAnnualAmount?: number | null;
  monthlyAmount?: number | null;
  planId?: PricingPlanSlug | null;
  reason?: string | null;
  valid?: boolean | null;
};

export interface LocalPricingPreview {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, LocalDisplayPrice>>
    >
  >;
  annualValidation?: Partial<Record<PricingPlanSlug, LocalAnnualValidation>>;
  usageBundles?: Partial<Record<UsageBundleSlug, LocalDisplayPrice>>;
}

// Plain-text mirror of the rendered billing FAQ block for FAQPage JSON-LD.
// Keep in sync with the "Common billing questions" markup below.
export function billingFaqJsonLdEntries(agencySaleOpen: boolean): FaqJsonLdEntry[] {
  return [
    {
      question: "What uses proof captures?",
      answer:
        "Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with screenshots, page text, and the original link.",
    },
    {
      question: "Do unused proof captures roll over?",
      answer:
        "Included proof captures reset every month and do not roll over — the caps are generous. Purchased proof captures never expire and carry over until you use them.",
    },
    {
      question: "What changes on Agency?",
      answer:
        "Agency includes 75 watchlists, 250 Collections, 2,500 proof captures/month, team seats, API/MCP access, client reports, and shared report branding.",
    },
    agencySaleOpen
      ? {
          question: "How does Agency checkout work?",
          answer: `Agency checkout is available when pricing loads in your region. Email ${SUPPORT_EMAIL} if you want an account review before buying.`,
        }
      : {
          question: "Why is Agency held?",
          answer: `Agency is available by account review. Email ${SUPPORT_EMAIL} and we will confirm fit directly.`,
        },
    {
      question: "Where do prices come from?",
      answer:
        "Display prices load from Dodo Payments in your local currency at preview time. We never hardcode checkout amounts in the app.",
    },
  ];
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

function formatMinorCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options: { roundWhole?: boolean } = {},
) {
  if (!Number.isFinite(amount) || !currency) return "";
  try {
    const decimals =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    const majorAmount = Number(amount) / 10 ** decimals;
    const displayAmount = options.roundWhole === false ? majorAmount : Math.ceil(majorAmount);
    const fractionDigits = options.roundWhole === false && Math.abs(displayAmount) < 10 ? 2 : 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(displayAmount);
  } catch {
    return `${currency} ${Math.ceil(Number(amount) / 100)}`;
  }
}

export function valueMathLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  annualIsValid: boolean,
) {
  const monthlyPrice = preview?.prices?.[planId]?.monthly;
  if (cycle === "yearly" && annualIsValid) {
    const yearlyPrice = preview?.prices?.[planId]?.yearly;
    const monthlyAmount = monthlyPrice?.amount;
    const annualAmount = yearlyPrice?.amount;
    const monthlyCurrency = monthlyPrice?.currency;
    const annualCurrency = yearlyPrice?.currency;
    const savingsAmount =
      Number.isFinite(monthlyAmount) &&
      Number.isFinite(annualAmount) &&
      monthlyCurrency &&
      annualCurrency &&
      monthlyCurrency === annualCurrency
        ? Number(monthlyAmount) * 12 - Number(annualAmount)
        : null;
    const savings = savingsAmount && savingsAmount > 0
      ? formatMinorCurrency(savingsAmount, monthlyCurrency)
      : "";
    return savings ? `Save ${savings} vs monthly` : DODO_ANNUAL_SAVINGS_LABEL;
  }

  const perDay = formatMinorCurrency(
    Number.isFinite(monthlyPrice?.amount) ? Number(monthlyPrice?.amount) / 30 : null,
    monthlyPrice?.currency,
  );
  return perDay ? `About ${perDay}/day` : "Simple monthly start";
}

function planValueSummary(planId: PricingPlanSlug) {
  if (planId === "scout") return "3 competitors checked every 6 hours";
  if (planId === "starter") return "10 competitors checked every 3 hours";
  if (planId === "agency")
    return "75 competitors — top 25 checked every 3 hours, the rest every 6 hours";
  return "Scheduled competitor monitoring";
}

function bundleValueLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  creditQuantity: number | null | undefined,
) {
  const price = preview?.usageBundles?.[bundleId];
  if (!Number.isFinite(price?.amount) || !Number.isFinite(creditQuantity) || Number(creditQuantity) <= 0) {
    return "Purchased proof captures never expire";
  }
  const unit = formatMinorCurrency(
    Number(price?.amount) / Number(creditQuantity),
    price?.currency,
    { roundWhole: false },
  );
  return unit ? `${unit} per proof capture` : "Purchased proof captures never expire";
}

function hasBundlePrice(preview: LocalPricingPreview | null, bundleId: UsageBundleSlug) {
  return Boolean(preview?.usageBundles?.[bundleId]?.display);
}

export function planIntentPath(
  signedIn: boolean,
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  const billingPath = `/app/billing?plan=${plan}&cycle=${cycle}&source=pricing#plans`;
  if (signedIn) return billingPath;
  return `/auth/signup?redirectTo=${encodeURIComponent(billingPath)}`;
}

export function PricingSection({
  commercialLaunch,
  initialPricingPreview,
}: {
  commercialLaunch: PublicCommercialLaunchSummary;
  initialPricingPreview: LocalPricingPreview | null;
}) {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const primaryCta = rootData.session ? "/app" : "/auth/signup";
  const primaryLabel = rootData.session ? "Open app" : "Create account";
  const [localPricing, setLocalPricing] = useState<LocalPricingPreview | null>(initialPricingPreview);
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>("monthly");
  const isPlanSaleOpen = (plan: PricingPlanSlug) =>
    plan === "scout"
      ? commercialLaunch.scoutSaleOpen
      : plan === "starter"
        ? commercialLaunch.starterSaleOpen
        : commercialLaunch.agencySaleOpen;
  const saleOpenPricingPlans = rootData.pricingPlans.filter((plan) => isPlanSaleOpen(plan.slug));
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

  useEffect(() => {
    if (localPricing?.available) return undefined;

    let active = true;
    let started = false;
    let observer: IntersectionObserver | undefined;
    let fallbackTimer = 0;

    const startPricingPreview = () => {
      if (!active || started) return;
      started = true;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
      // The pricing section sits far below the fold, and the preview can take
      // seconds (Dodo checkout-preview latency). Fetching it eagerly on mount
      // kept the page's network busy after render (dogfood c99ff5d9b87b:
      // rendered audit reached network idle in 5136ms). Fetch only when the
      // visitor is close to the section, so the document load settles fast
      // while prices still arrive before the section becomes visible.
      fetch("/api/pricing-preview")
        .then((response) => (response.ok ? response.json() : null))
        .then((value: unknown) => {
          const preview = value as LocalPricingPreview | null;
          if (active && preview?.available) setLocalPricing(preview);
        })
        .catch(() => {
          // Keep honest checkout-localized fallbacks on fetch failure.
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

    // Safety net for viewers who never scroll (print, landmark-jumping screen
    // readers, find-in-page jumps): prices still arrive eventually. Fires long
    // after the document has settled, so it never delays the initial load.
    fallbackTimer = window.setTimeout(startPricingPreview, 10_000);

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
    };
  }, [localPricing?.available]);

  return (
    <section className="f9-growth-pricing" id="pricing">
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

      <div className="f9-commerce-grid ld-reveal">
        {rootData.pricingPlans.map((plan) => {
          const yearlyReady = hasPrice(localPricing, plan.slug, "yearly");
          const selectedReady = hasPrice(localPricing, plan.slug, billingCycle);
          const annualIsValid = dodoAnnualSavingsIsValid(
            localPricing?.annualValidation?.[plan.slug],
          );
          const planSaleOpen = isPlanSaleOpen(plan.slug);
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
                    // Monthly is selected: mention the annual cadence only
                    // when annual checkout is actually available for this
                    // plan. Otherwise the note stays on the monthly cadence
                    // and never claims the annual savings offer.
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

      <p className="ld-pricing-note">
        {EVIDENCE_USAGE_CUSTOMER_COPY}
      </p>

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
            <dt>{commercialLaunch.agencySaleOpen ? "How does Agency checkout work?" : "Why is Agency held?"}</dt>
            <dd>
              {commercialLaunch.agencySaleOpen ? (
                <>
                  Agency checkout is available when pricing loads in your region. Email{" "}
                  <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you want an account review before
                  buying.
                </>
              ) : (
                <>
                  Agency is available by account review. Email{" "}
                  <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we will confirm fit directly.
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
