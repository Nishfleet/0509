import { Form, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { CheckoutReturnNotice } from "~/components/checkout-return-notice";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { billingSkuForPlanCheckout, TOP_UP_PACK_DISPLAY } from "~/lib/billing-sku-catalog";
import { agencyCheckoutHeldCustomerCopy } from "~/lib/customer-billing-copy";
import {
  DODO_ANNUAL_SAVINGS_LABEL,
  dodoAnnualSavingsIsValid,
  dodoAnnualUnavailableCopy,
  type DodoAnnualDisplayValidation,
} from "~/lib/dodo-pricing-display";
import {
  EVIDENCE_USAGE_CUSTOMER_COPY,
  pricingPlans,
  TOP_UP_INACTIVE_PLAN_COPY,
  usageBundles,
  type PricingBillingCycle,
  type PricingPlanSlug,
  type UsageBundleSlug,
} from "~/lib/pricing";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PAYMENT_ISSUE_STATUSES = new Set(["subscription.failed", "subscription.on_hold"]);
const LEGACY_PLAN_RETURN_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000;

type AppPricingPreview = {
  available?: boolean;
  prices?: Partial<
    Record<
      PricingPlanSlug,
      Partial<Record<PricingBillingCycle, { display?: string | null }>>
    >
  >;
  annualValidation?: Partial<Record<PricingPlanSlug, AppAnnualValidation>>;
  usageBundles?: Partial<Record<UsageBundleSlug, { display?: string | null }>>;
};

type AppAnnualValidation = {
  planId?: PricingPlanSlug | null;
  valid: boolean;
  reason: string;
  monthlyAmount: number | null;
  annualAmount: number | null;
  expectedAnnualAmount: number | null;
  currency: string | null;
  billingCountry: string | null;
};

export const meta = () => [{ title: "Billing & usage | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Billing & usage" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const { PLAN_LIMITS, checkPlanLimit, getProofUsageSummary } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const workspace = await requireWorkspaceSession(env, request);
  const { session, workspaceUserId, isMember, ownerName } = workspace;
  const canManageBilling = !isMember || workspaceUserId === session.user.id;
  const url = new URL(request.url);
  const checkoutNotice = url.searchParams.get("checkout");
  const checkoutKind = checkoutNotice === "dodo" && url.searchParams.get("kind") === "top_up"
    ? "top_up"
    : "plan";
  const portalNotice = url.searchParams.get("portal");
  const selectedPlanParam = cleanPricingPlan(url.searchParams.get("plan"));
  const selectedPlan = selectedPlanParam ?? "starter";
  const selectedCycleParam = coerceBillingCycle(url.searchParams.get("cycle"));
  const selectedSource = cleanSourceParam(url.searchParams.get("source"));
  const checkoutStatus = cleanDodoCheckoutStatus(url.searchParams.get("status"));

  const { dailyProofCapForPlan } = await import("~/lib/monitoring.server");
  const { listActiveProofCreditGrants } = await import("~/lib/plan.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  const { summarizeCommercialLaunch } = await import("~/lib/commercial-launch-gate.server");
  const [
    billing,
    proofUsage,
    watchlistUsage,
    collectionUsage,
    creditGrants,
    pricingPreview,
  ] = await Promise.all([
    getUserPlanBillingInfo(env, workspaceUserId),
    getProofUsageSummary(env, workspaceUserId),
    checkPlanLimit(env, workspaceUserId, "watchlists"),
    checkPlanLimit(env, workspaceUserId, "collections"),
    listActiveProofCreditGrants(env, workspaceUserId),
    previewDodo0509PlanPrices({ env, request, trustProxyHeaders: false }),
  ]);
  const customerBilling = {
    plan: billing.plan,
    dodoStatus: billing.dodoStatus,
    dodoNextBillingAt: billing.dodoNextBillingAt,
    billingInterval: billing.billingInterval,
    planUpdatedAt: billing.planUpdatedAt,
  };
  const selectedCycle =
    selectedCycleParam ??
    (billing.billingInterval === "annual" ? "yearly" : "monthly");
  const visibleCreditGrants = canManageBilling
    ? creditGrants
    : creditGrants.map((grant) => ({ ...grant, providerPaymentId: null }));
  const terminalCheckoutReturned =
    checkoutNotice === "dodo" &&
    (checkoutStatus === "failed" || checkoutStatus === "cancelled" || checkoutStatus === "canceled");
  const checkoutStartedAt =
    checkoutNotice === "dodo" ? cleanCheckoutStartedAt(url.searchParams.get("started")) : null;
  const currentCycleParam = billing.billingInterval === "annual"
    ? "yearly"
    : billing.billingInterval === "monthly"
      ? "monthly"
      : null;
  const legacyPlanReturnConfirmed =
    checkoutNotice === "dodo" &&
    !terminalCheckoutReturned &&
    checkoutKind === "plan" &&
    !checkoutStartedAt &&
    billing.plan !== "free" &&
    selectedPlanParam === billing.plan &&
    selectedCycleParam === currentCycleParam &&
    isRecentTimestamp(billing.planUpdatedAt, LEGACY_PLAN_RETURN_CONFIRMATION_WINDOW_MS);

  return {
    email: session.user.email,
    billing: customerBilling,
    proofUsage,
    watchlistUsage,
    collectionUsage,
    planLimits: PLAN_LIMITS[customerBilling.plan],
    dailyProofCap: dailyProofCapForPlan(customerBilling.plan, proofUsage.extraCredits),
    creditGrants: visibleCreditGrants,
    plans: pricingPlans(),
    usageBundles: usageBundles(),
    pricingPreview,
    commercialLaunch: summarizeCommercialLaunch(env),
    canManageBilling,
    billingOwnerName: ownerName,
    selectedPlan,
    selectedCycle,
    selectedSource,
    checkoutReturned: checkoutNotice === "dodo" && !terminalCheckoutReturned,
    checkoutTerminalFailure: terminalCheckoutReturned,
    checkoutKind,
    checkoutTopUpSku: checkoutKind === "top_up" ? cleanSourceParam(url.searchParams.get("sku")) : null,
    checkoutTopUpPaymentId: checkoutKind === "top_up" ? cleanDodoPaymentId(url.searchParams.get("payment_id")) : null,
    checkoutStartedAt,
    legacyPlanReturnConfirmed,
    blockedCheckout: checkoutNotice === "already-subscribed",
    pendingCheckout:
      checkoutNotice === "already-started" ||
      (billing.dodoStatus === "checkout_pending" && checkoutNotice !== "dodo"),
    cancelledCheckout: checkoutNotice === "cancelled",
    agencyCheckoutHeld: checkoutNotice === "agency-held",
    planCheckoutUnavailable: checkoutNotice === "plan-unavailable",
    annualCheckoutUnavailable: checkoutNotice === "annual-unavailable",
    topUpRequiresPlan: checkoutNotice === "top-up-requires-plan",
    topUpCheckoutUnavailable: checkoutNotice === "top-up-unavailable",
    portalUnavailable: portalNotice === "unavailable",
    hasPortal: Boolean(billing.dodoCustomerId),
  };
}

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  const { billing } = data;
  const planLabel = billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1);
  const isPaid = billing.plan !== "free";
  const hasPaymentIssue = isPaid && PAYMENT_ISSUE_STATUSES.has(billing.dodoStatus ?? "");
  const selectedPlan = data.selectedPlan ?? "starter";
  const selectedCycle = data.selectedCycle ?? (billing.billingInterval === "annual" ? "yearly" : "monthly");
  const selectedSource = data.selectedSource ?? null;
  const billingCycleLabel = billing.billingInterval === "annual"
    ? "Annual"
    : billing.billingInterval === "monthly"
      ? "Monthly"
      : null;
  const canManageBilling = data.canManageBilling !== false;
  const plans = data.plans ?? pricingPlans();
  const bundles = data.usageBundles ?? usageBundles();
  const pricingPreview = data.pricingPreview as AppPricingPreview | null | undefined;
  const commercialLaunch = data.commercialLaunch ?? {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };
  const selectedAnnualValidation = annualValidationFor(pricingPreview, selectedPlan);
  const digestCadenceLabel =
    data.planLimits.digestCadence === "daily_and_weekly"
      ? "Daily and weekly"
      : data.planLimits.digestCadence === "weekly"
        ? "Weekly"
        : "Not included";

  return (
    <DashboardPage>
      <DashboardPageHeader
        lead="Current plan, evidence usage, and renewal status."
        title="Billing & usage"
      />
    <section className="f9-app-stack">
      {data.blockedCheckout ? (
        <div className="f9-message is-error">
          <p>
            You already have an active {planLabel} plan, so we stopped that checkout — finishing it
            would have started a second, overlapping subscription. To switch plans or change billing,
            <Link to="/app/support?category=billing"> open a billing support case</Link> from {data.email}.
          </p>
        </div>
      ) : null}

      {data.pendingCheckout ? (
        <div className="f9-message is-error">
          <p>
            A Dodo checkout is already open for this account. Finish that checkout, or wait until
            that payment link expires before starting a new one. If you need help, email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email}.
          </p>
        </div>
      ) : null}

      {data.cancelledCheckout ? (
        <div className="f9-message" role="status">
          <p>
            Checkout was cancelled. No plan change was made. If that Dodo payment link is still
            active, finish it or let it expire; a new monthly or annual checkout opens after Dodo
            confirms cancellation or the link expires.
          </p>
        </div>
      ) : null}

      {data.agencyCheckoutHeld ? (
        <div className="f9-message is-error">
          <p>{agencyCheckoutHeldCustomerCopy()}</p>
        </div>
      ) : null}

      {data.planCheckoutUnavailable ? (
        <div className="f9-message is-error">
          <p>
            That plan checkout is temporarily unavailable while billing finishes setup. Email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email} and we will help.
          </p>
        </div>
      ) : null}

      {data.topUpRequiresPlan ? (
        <div className="f9-message is-error" role="alert">
          <p>
            Top-up packs can only be added to a paid plan. Choose a plan first, then add extra
            checks whenever you need them.
          </p>
        </div>
      ) : null}

      {data.topUpCheckoutUnavailable ? (
        <div className="f9-message is-error" role="alert">
          <p>
            That top-up pack is temporarily unavailable while billing pricing is verified. Your plan
            is unchanged.
          </p>
        </div>
      ) : null}

      {data.portalUnavailable ? (
        <div className="f9-message is-error">
          <p>
            We couldn't open your billing portal just now. Email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> or{" "}
            <Link to="/app/support?category=billing">open a billing support case</Link> and we'll handle
            the change directly.
          </p>
        </div>
      ) : null}

      {data.checkoutReturned ? (
        <CheckoutReturnNotice
          creditGrants={data.creditGrants}
          kind={data.checkoutKind === "top_up" ? "top_up" : "plan"}
          legacyPlanReturnConfirmed={data.legacyPlanReturnConfirmed}
          plan={billing.plan}
          planUpdatedAt={billing.planUpdatedAt}
          checkoutStartedAt={data.checkoutStartedAt}
          topUpPaymentId={data.checkoutTopUpPaymentId}
          topUpSku={data.checkoutTopUpSku}
        />
      ) : null}

      {data.checkoutTerminalFailure ? (
        <div className="f9-message is-error" role="alert">
          <p>
            Dodo did not complete that checkout. No billing change has been applied; wait for the
            signed provider update or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need
            us to clear the pending checkout.
          </p>
        </div>
      ) : null}

      {data.annualCheckoutUnavailable ? (
        <div className="f9-message is-error" role="alert">
          <p>{dodoAnnualUnavailableCopy(selectedAnnualValidation)}</p>
        </div>
      ) : null}

      {!canManageBilling ? (
        <div className="f9-message" role="status">
          <p>
            Billing is managed by the workspace owner
            {data.billingOwnerName ? `, ${data.billingOwnerName}` : ""}. You can view usage here,
            but only the owner can change plans, buy packs, or open billing settings.
          </p>
        </div>
      ) : null}

      {hasPaymentIssue ? (
        <article className="f9-checkout-banner is-pending" aria-live="polite">
          <div>
            <span className="f9-app-kicker">Payment issue</span>
            <h2>Your last renewal payment didn't go through.</h2>
            <p>
              Your {planLabel} plan is still active while the payment provider retries. Please check
              the card on the receipt email from Dodo Payments, or email{" "}
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll help sort it out before anything
              is interrupted.
            </p>
          </div>
        </article>
      ) : null}

      <article className="f9-app-panel f9-plan-picker-panel" id="plans">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Choose inside the app</span>
            <h2>Pick a plan and billing cycle</h2>
            <p className="f9-muted-copy">
              Every plan checkout must validate against Dodo checkout preview for your location.
              Annual checkout also stays off unless the annual SKU validates as{" "}
              {DODO_ANNUAL_SAVINGS_LABEL}.
            </p>
          </div>
          <div className="f9-cycle-toggle" role="group" aria-label="Billing cycle">
            <Link
              aria-current={selectedCycle === "monthly" ? "true" : undefined}
              className={selectedCycle === "monthly" ? "is-active" : ""}
              to={billingPickerPath(selectedPlan, "monthly", selectedSource)}
            >
              Monthly
            </Link>
            <Link
              aria-current={selectedCycle === "yearly" ? "true" : undefined}
              className={selectedCycle === "yearly" ? "is-active" : ""}
              to={billingPickerPath(selectedPlan, "yearly", selectedSource)}
            >
              Annual
            </Link>
          </div>
        </div>

        <div className="f9-app-plan-grid">
          {plans.map((plan) => {
            const planCyclePrice = planPrice(pricingPreview, plan.slug, selectedCycle);
            const annualValidation = annualValidationFor(pricingPreview, plan.slug);
            const annualIsValid = dodoAnnualSavingsIsValid(annualValidation);
            const annualBlocked = selectedCycle === "yearly" && !annualIsValid;
            const priceReady = Boolean(planCyclePrice);
            const planSaleOpen = planSaleIsOpen(commercialLaunch, plan.slug);
            const isCurrentPlan = billing.plan === plan.slug;
            const checkoutSku = billingSkuForPlanCheckout(plan.slug, selectedCycle);
            const canStartCheckout =
              canManageBilling &&
              billing.plan === "free" &&
              !isCurrentPlan &&
              planSaleOpen &&
              billing.dodoStatus !== "checkout_pending" &&
              priceReady &&
              Boolean(checkoutSku) &&
              !annualBlocked;
            const selected = selectedPlan === plan.slug;
            return (
              <section
                className={`f9-app-plan-card${plan.slug === "starter" ? " is-recommended" : ""}${selected ? " is-selected" : ""}`}
                key={plan.slug}
              >
                <div className="f9-app-plan-card-head">
                  <div>
                    <span className="f9-app-kicker">{plan.name}</span>
                    <strong>{planCyclePrice || priceFallback(plan, selectedCycle)}</strong>
                  </div>
                  {isCurrentPlan ? (
                    <span className="f9-status-pill is-healthy">Current plan</span>
                  ) : plan.slug === "starter" ? (
                    <span className="f9-status-pill">Recommended</span>
                  ) : null}
                </div>
                <p>{plan.detail}</p>
                <div className="f9-plan-limit-strip" aria-label={`${plan.name} limits`}>
                  <span>{plan.watchlistLimit ?? 0} watchlists</span>
                  <span>{plan.boardLimit ?? 0} Collections</span>
                  <span>{(plan.evidenceChecksPerMonth ?? 0).toLocaleString("en-US")} checks/mo</span>
                </div>
                {selectedCycle === "yearly" ? (
                  <p className={`f9-annual-note${annualIsValid ? " is-valid" : " is-unavailable"}`}>
                    {annualIsValid
                      ? DODO_ANNUAL_SAVINGS_LABEL
                      : dodoAnnualUnavailableCopy(annualValidation)}
                  </p>
                ) : (
                  <p className="f9-annual-note">Monthly billing. Annual keeps monthly usage buckets.</p>
                )}
                <ul className="f9-plan-feature-list">
                  {plan.features.slice(0, 5).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="f9-plan-actions">
                  {!canManageBilling ? (
                    <button className="f9-secondary-button" disabled type="button">
                      Owner managed
                    </button>
                  ) : isCurrentPlan ? (
                    <Link className="f9-secondary-button" to="/app/support?category=billing">
                      Change with support
                    </Link>
                  ) : !planSaleOpen ? (
                    <Link className="f9-secondary-button" to="/app/support?category=billing">
                      Request Agency access
                    </Link>
                  ) : canStartCheckout && checkoutSku ? (
                    <Form action="/api/billing/dodo/checkout" method="post">
                      <input name="sku" type="hidden" value={checkoutSku} />
                      {selectedSource ? <input name="source" type="hidden" value={selectedSource} /> : null}
                      <SubmitButton
                        className="f9-primary-button"
                        match={{ sku: checkoutSku }}
                        pendingLabel="Redirecting…"
                      >
                        Start {selectedCycle === "yearly" ? "annual" : "monthly"}
                      </SubmitButton>
                    </Form>
                  ) : billing.plan !== "free" ? (
                    <Link className="f9-secondary-button" to="/app/support?category=billing">
                      Change with support
                    </Link>
                  ) : (
                    <button className="f9-secondary-button" disabled type="button">
                      {annualBlocked ? "Annual unavailable" : checkoutSku ? "Price loading" : "Checkout unavailable"}
                    </button>
                  )}
                  {!selected ? (
                    <Link
                      className="f9-text-link"
                      to={billingPickerPath(plan.slug, selectedCycle, selectedSource)}
                    >
                      Select
                    </Link>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Plan &amp; billing</span>
            <h2>
              {planLabel} plan{isPaid ? "" : " — free account"}
            </h2>
          </div>
          {!isPaid ? (
            <Link className="f9-primary-button" to="/app/billing?source=billing#plans">
              View plans
            </Link>
          ) : null}
        </div>

        <div className="f9-work-list is-compact">
          <div className="f9-work-row">
            <strong>Status</strong>
            <span>{formatBillingStatus(billing.plan, billing.dodoStatus)}</span>
          </div>
          {isPaid && billing.dodoNextBillingAt ? (
            <div className="f9-work-row">
              <strong>Renews on</strong>
              <span>{formatDate(billing.dodoNextBillingAt)}</span>
            </div>
          ) : null}
          {isPaid && billingCycleLabel ? (
            <div className="f9-work-row">
              <strong>Billing cycle</strong>
              <span>{billingCycleLabel}</span>
            </div>
          ) : null}
          {billing.planUpdatedAt ? (
            <div className="f9-work-row">
              <strong>Last billing change</strong>
              <span>{formatDate(billing.planUpdatedAt)}</span>
            </div>
          ) : null}
          <div className="f9-work-row">
            <strong>Competitor watchlists</strong>
            <span>
              {data.watchlistUsage.limit > 0 ? (
                `${data.watchlistUsage.current} of ${data.watchlistUsage.limit} used`
              ) : (
                <>
                  Not included on this plan — <Link to="/app/billing?source=watchlists#plans">view plans</Link>
                </>
              )}
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Collections</strong>
            <span>
              {data.collectionUsage.limit > 0 ? (
                `${data.collectionUsage.current} of ${data.collectionUsage.limit} used`
              ) : (
                <>
                  Not included on this plan — <Link to="/app/billing?source=collections#plans">view plans</Link>
                </>
              )}
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Evidence checks (this month)</strong>
            <span>
              {data.proofUsage.limit > 0 ? (
                <>
                  {data.proofUsage.includedUsed ?? data.proofUsage.used} of{" "}
                  {data.proofUsage.baseLimit} included used
                  {data.proofUsage.topUpRemaining && data.proofUsage.topUpRemaining > 0
                    ? ` · ${data.proofUsage.topUpRemaining} purchased checks remaining`
                    : ""}
                  {data.proofUsage.periodStart && data.proofUsage.periodEnd ? (
                    <>
                      {" "}
                      · period{" "}
                      <LocalTime iso={data.proofUsage.periodStart} mode="date" /> –{" "}
                      <LocalTime iso={data.proofUsage.periodEnd} mode="date" />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Not included on this plan — <Link to="/app/billing?source=evidence#plans">view plans</Link>
                </>
              )}
            </span>
          </div>
          <p className="f9-muted-copy">{EVIDENCE_USAGE_CUSTOMER_COPY}</p>
          {!data.proofUsage.canSpendTopUps &&
          data.proofUsage.topUpRetainedWhileInactive &&
          data.proofUsage.topUpRetainedWhileInactive > 0 ? (
            <p className="f9-muted-copy">{TOP_UP_INACTIVE_PLAN_COPY}</p>
          ) : null}
          {data.creditGrants.map((grant) => (
            <div className="f9-work-row" key={`${grant.skuSlug ?? "grant"}-${grant.grantedAt}`}>
              <strong>Purchased pack</strong>
              <span>
                {grant.credits} evidence checks from {topUpPackName(grant.skuSlug, grant.credits)} — never expire
              </span>
            </div>
          ))}
          <div className="f9-work-row">
            <strong>Digest schedule</strong>
            <span>{digestCadenceLabel}</span>
          </div>
        </div>
      </article>

      <article className="f9-app-panel" id="top-ups">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Extra check capacity</span>
            <h2>Top up busy weeks without changing plans</h2>
            <p className="f9-muted-copy">
              Purchased checks never expire. They add evidence-check capacity only; they do not
              change watchlist limits, cadence, or plan features.
            </p>
          </div>
        </div>
        <div className="f9-topup-grid">
          {bundles.map((bundle) => {
            const previewPrice = bundlePrice(pricingPreview, bundle.slug);
            const price = previewPrice || bundle.priceLabel;
            const sku = bundle.sku ?? "";
            const ready = Boolean(previewPrice && sku);
            return (
              <section className="f9-topup-card" key={bundle.slug}>
                <span className="f9-app-kicker">{bundle.creditLabel}</span>
                <h3>{bundle.name}</h3>
                <strong>{price}</strong>
                <p>{bundle.detail}</p>
                {!canManageBilling ? (
                  <button className="f9-secondary-button" disabled type="button">
                    Owner managed
                  </button>
                ) : isPaid && ready ? (
                  <Form action="/api/billing/dodo/checkout" method="post">
                    <input name="sku" type="hidden" value={sku} />
                    {selectedSource ? <input name="source" type="hidden" value={selectedSource} /> : null}
                    <SubmitButton
                      className="f9-secondary-button"
                      match={{ sku }}
                      pendingLabel="Redirecting…"
                    >
                      Buy pack
                    </SubmitButton>
                  </Form>
                ) : isPaid ? (
                  <button className="f9-secondary-button" disabled type="button">
                    Price loading
                  </button>
                ) : (
                  <Link className="f9-secondary-button" to="/app/billing?source=top-up#plans">
                    Choose a plan first
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Manage billing</span>
            <h2>Change, cancel, or get invoices</h2>
          </div>
        </div>
        <div className="f9-work-list is-compact">
          {!canManageBilling ? (
            <div className="f9-work-row">
              <strong>Manage subscription</strong>
              <span>Owner managed</span>
            </div>
          ) : isPaid && data.hasPortal ? (
            <div className="f9-work-row">
              <strong>Manage subscription</strong>
              <span>
                Open Dodo's hosted portal for card and invoice tasks. Plan changes and cancellation
                stay backed by support until the subscription-update setting is confirmed.{" "}
                <Form action="/api/billing/dodo/portal" method="post" style={{ display: "inline" }}>
                  <SubmitButton className="f9-secondary-button" pendingLabel="Redirecting…">
                    Open billing portal
                  </SubmitButton>
                </Form>
              </span>
            </div>
          ) : null}
          <div className="f9-work-row">
            <strong>Change or cancel your plan</strong>
            <span>
              {isPaid && data.hasPortal
                ? "Prefer support? "
                : ""}
              <Link to="/app/support?category=billing">Open a billing support case</Link> from{" "}
              {data.email}. Cancellation stops future renewals — you keep access until the end of the
              period you've paid for.
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Receipts and invoices</strong>
            <span>
              Dodo Payments emails a receipt for every charge. Need a copy or a GST invoice?{" "}
              <Link to="/app/support?category=billing">Open a billing support case</Link>.
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Refunds</strong>
            <span>
              Five to Nine is a digital product delivered immediately, so purchases are final and we
              don't offer refunds (<Link to="/terms">terms</Link>). Something not working as
              expected? <Link to="/app/support?category=billing">Open a billing support case</Link> and
              we'll troubleshoot it with the account trail attached.
            </span>
          </div>
        </div>
      </article>
    </section>
    </DashboardPage>
  );
}

function formatBillingStatus(plan: string, dodoStatus: string | null) {
  if (plan === "free") {
    if (dodoStatus === "refunded") return "Refunded — reverted to the free account";
    if (dodoStatus === "subscription.cancelled") return "Cancelled — on the free account";
    if (dodoStatus === "subscription.expired") return "Expired — on the free account";
    return "Free account";
  }

  if (dodoStatus && PAYMENT_ISSUE_STATUSES.has(dodoStatus)) {
    return "Active — payment retry in progress";
  }

  if (dodoStatus === "cancellation_scheduled") {
    return "Active — cancels at the end of this billing period";
  }

  return "Active";
}

function formatDate(value: string) {
  return <LocalTime fallback={value} iso={value} mode="date" />;
}

function topUpPackName(skuSlug: string | null | undefined, credits: number) {
  if (skuSlug && isTopUpDisplayKey(skuSlug)) {
    return TOP_UP_PACK_DISPLAY[skuSlug].name;
  }
  return `${credits.toLocaleString("en-IN")} check pack`;
}

function isTopUpDisplayKey(value: string): value is keyof typeof TOP_UP_PACK_DISPLAY {
  return value in TOP_UP_PACK_DISPLAY;
}

function cleanPricingPlan(value: string | null): PricingPlanSlug | null {
  return value === "scout" || value === "starter" || value === "agency" ? value : null;
}

function coerceBillingCycle(value: string | null): PricingBillingCycle | null {
  if (value === "yearly") return "yearly";
  if (value === "monthly") return "monthly";
  return null;
}

function cleanSourceParam(value: string | null) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(cleaned) ? cleaned : null;
}

function cleanDodoCheckoutStatus(value: string | null) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_.-]{1,64}$/.test(cleaned) ? cleaned : null;
}

function cleanCheckoutStartedAt(value: string | null) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned || cleaned.length > 40) return null;
  const timestamp = Date.parse(cleaned);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isRecentTimestamp(value: string | null, windowMs: number) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return false;
  const now = Date.now();
  return timestamp <= now + 2 * 60 * 1000 && now - timestamp <= windowMs;
}

function cleanDodoPaymentId(value: string | null) {
  const cleaned = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{1,96}$/.test(cleaned) ? cleaned : null;
}

function billingPickerPath(
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
  source: string | null,
) {
  const params = new URLSearchParams({ plan, cycle });
  if (source) params.set("source", source);
  return `/app/billing?${params.toString()}#plans`;
}

function planPrice(
  preview: AppPricingPreview | null | undefined,
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  return preview?.prices?.[plan]?.[cycle]?.display || "";
}

function bundlePrice(
  preview: AppPricingPreview | null | undefined,
  bundle: UsageBundleSlug,
) {
  return preview?.usageBundles?.[bundle]?.display || "";
}

function annualValidationFor(
  preview: AppPricingPreview | null | undefined,
  plan: PricingPlanSlug,
): DodoAnnualDisplayValidation | null {
  return preview?.annualValidation?.[plan] ?? null;
}

function priceFallback(
  plan: ReturnType<typeof pricingPlans>[number],
  cycle: PricingBillingCycle,
) {
  return cycle === "yearly" ? plan.yearlyLabel : plan.monthlyLabel;
}

function planSaleIsOpen(
  commercialLaunch: {
    scoutSaleOpen?: boolean;
    starterSaleOpen?: boolean;
    agencySaleOpen?: boolean;
  },
  plan: PricingPlanSlug,
) {
  if (plan === "scout") return commercialLaunch.scoutSaleOpen !== false;
  if (plan === "starter") return commercialLaunch.starterSaleOpen !== false;
  return commercialLaunch.agencySaleOpen === true;
}
