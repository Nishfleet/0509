import { Form, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { ReactNode } from "react";

import { CheckoutReturnNotice } from "~/components/checkout-return-notice";
import { Pill } from "~/components/pill";
import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { WorkingHeader } from "~/components/workspace/working-header";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
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
import { isPlanUpgrade, parsePlanFamily } from "~/lib/plan-entitlements";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { UserPlanBillingInfo } from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";

const PAYMENT_ISSUE_STATUSES = new Set(["payment.failed", "subscription.failed", "subscription.on_hold"]);
const PLAN_CHANGE_PENDING_STATUS = "plan_change_pending";
const PLAN_CHANGE_SCHEDULED_STATUS = "plan_change_scheduled";
const CANCELLATION_SCHEDULED_STATUS = "cancellation_scheduled";
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

type PlanChangeNoticeKind =
  | "preview"
  | "accepted"
  | "scheduled"
  | "requires-subscription"
  | "unavailable"
  | "pending-checkout"
  | "pending-change"
  | "reconciled"
  | "recovered"
  | "status-refreshed"
  | "cancellation-scheduled"
  | "payment-issue"
  | "current"
  | "annual-unavailable";

type PlanChangePreviewNotice = {
  plan: "scout" | "starter";
  cycle: PricingBillingCycle;
  sku: string;
  charge: string;
  previewToken: string;
  effectiveAt: "immediately" | "next_billing_date";
};

type PlanChangePreviewTarget = Omit<PlanChangePreviewNotice, "charge" | "previewToken">;

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
  const cloudflare = getOptionalCloudflareContext(context);
  const workspace = await requireWorkspaceSession(env, request);
  const { session, workspaceUserId, isMember, ownerName } = workspace;
  const canManageBilling = !isMember || workspaceUserId === session.user.id;
  const url = new URL(request.url);
  const checkoutNotice = url.searchParams.get("checkout");
  const checkoutKind = checkoutNotice === "dodo" && url.searchParams.get("kind") === "top_up"
    ? "top_up"
    : "plan";
  const portalNotice = url.searchParams.get("portal");
  const planChangeNotice = cleanPlanChangeNotice(url.searchParams.get("plan-change"));
  const planChangePreviewTarget = planChangeNotice === "preview"
    ? cleanPlanChangePreviewTarget(url.searchParams)
    : null;
  const selectedPlanParam = cleanPricingPlan(url.searchParams.get("plan"));
  const selectedPlan = selectedPlanParam ?? "starter";
  const selectedCycleParam = coerceBillingCycle(url.searchParams.get("cycle"));
  const selectedSource = cleanSourceParam(url.searchParams.get("source"));
  const checkoutStatus = cleanDodoCheckoutStatus(url.searchParams.get("status"));

  const { dailyProofCapForPlan } = await import("~/lib/monitoring.server");
  const { listActiveProofCreditGrants } = await import("~/lib/plan.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  const { enforceBillingProviderRateLimit } = await import("~/lib/rate-limit.server");
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
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
    (async () => {
      const rateLimitResponse = await enforceBillingProviderRateLimit(
        request,
        env,
        workspaceUserId,
        "pricing",
        cloudflare?.ctx,
      );
      if (rateLimitResponse) throw rateLimitResponse;
      // Currency display only — resolve buyer country identically to the
      // public /api/pricing-preview surface (default trustProxyHeaders: true)
      // so in-app billing and the landing page never show ₹ vs $ for one
      // browser. Auth-origin trust is pinned separately via BETTER_AUTH_URL.
      return previewDodo0509PlanPrices({ env, request });
    })(),
  ]);
  const customerBilling = {
    plan: billing.plan,
    dodoStatus: billing.dodoStatus,
    hasDodoPlanChangePendingTarget: Boolean(billing.dodoPlanChangeProductId),
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
  const planChangePreview = canManageBilling && planChangePreviewTarget
    ? await loadPlanChangePreviewNotice({
        env,
        request,
        billing,
        workspaceUserId,
        target: planChangePreviewTarget,
        ctx: cloudflare?.ctx,
      })
    : null;

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
    commercialLaunch: publicCommercialLaunchSummary(env),
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
    invalidCheckoutTarget: checkoutNotice === "invalid-target",
    cancelledCheckout: checkoutNotice === "cancelled",
    agencyCheckoutHeld: checkoutNotice === "agency-held",
    planCheckoutUnavailable: checkoutNotice === "plan-unavailable",
    annualCheckoutUnavailable: checkoutNotice === "annual-unavailable",
    topUpRequiresPlan: checkoutNotice === "top-up-requires-plan",
    topUpCheckoutUnavailable: checkoutNotice === "top-up-unavailable",
    portalUnavailable: portalNotice === "unavailable",
    hasPortal: Boolean(billing.dodoCustomerId),
    hasDodoSubscription: Boolean(billing.dodoSubscriptionId),
    planChangeNotice: canManageBilling ? planChangeNotice : null,
    planChangePreview,
  };
}

export default function BillingRoute() {
  const data = useLoaderData<typeof loader>();
  const { billing } = data;
  const planLabel = billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1);
  const isPaid = billing.plan !== "free";
  const hasPaymentIssue = isPaid && PAYMENT_ISSUE_STATUSES.has(billing.dodoStatus ?? "");
  const hasPlanChangePending =
    isPaid &&
    isBlockingPlanChangeStatus(
      billing.dodoStatus,
      billing.planUpdatedAt,
      billing.hasDodoPlanChangePendingTarget,
    );
  const hasCancellationScheduled = isPaid && billing.dodoStatus === CANCELLATION_SCHEDULED_STATUS;
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
  const pricingPreviewResolved = pricingPreview != null;
  const pricingUnavailable = pricingPreview?.available === false;
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
    <DashboardPage className="f9-wk-page f9-acct-page f9-acct-billing">
      <WorkingHeader
        context={
          canManageBilling
            ? `${planLabel} plan. Usage, renewal, and provider-backed billing controls.`
            : `${planLabel} plan. Billing changes are managed by the workspace owner.`
        }
        title="Billing & usage"
      />
    <section className="f9-acct-flow">
      <BillingLifecycleSummary
        billing={billing}
        canManageBilling={canManageBilling}
        email={data.email}
        hasPortal={data.hasPortal}
      />
      {data.invalidCheckoutTarget ? (
        <div
          aria-atomic="true"
          aria-live="assertive"
          className="f9-wk-notice is-error"
          role="alert"
        >
          <p>
            That checkout option is invalid or no longer available. Choose a current plan or check
            pack below; no billing change was made.
          </p>
        </div>
      ) : null}

      {data.blockedCheckout ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>
            You already have an active {planLabel} plan, so we stopped that checkout — finishing it
            would have started a second, overlapping subscription. To switch plans or change billing,
            <Link to="/app/support?category=billing"> open a billing support case</Link> from {data.email}.
          </p>
        </div>
      ) : null}

      {data.pendingCheckout ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>
            A Dodo checkout is already open for this account. Finish that checkout, or wait until
            that payment link expires before starting a new one. If you need help, email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email}.
          </p>
        </div>
      ) : null}

      {data.cancelledCheckout ? (
        <div className="f9-wk-notice" role="status">
          <p>
            Checkout was cancelled. No plan change was made. If that Dodo payment link is still
            active, finish it or let it expire; a new monthly or annual checkout opens after Dodo
            confirms cancellation or the link expires.
          </p>
        </div>
      ) : null}

      {data.agencyCheckoutHeld ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>{agencyCheckoutHeldCustomerCopy()}</p>
        </div>
      ) : null}

      {data.planCheckoutUnavailable ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>
            That plan checkout is temporarily unavailable while billing finishes setup. Email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email} and we will help.
          </p>
        </div>
      ) : null}

      {data.topUpRequiresPlan ? (
        <div className="f9-wk-notice is-error" role="alert">
          <p>
            Top-up packs can only be added to a paid plan. Choose a plan first, then add extra
            proof captures whenever you need them.
          </p>
        </div>
      ) : null}

      {data.topUpCheckoutUnavailable ? (
        <div className="f9-wk-notice is-error" role="alert">
          <p>
            That top-up pack is temporarily unavailable while billing pricing is verified. Your plan
            is unchanged.
          </p>
        </div>
      ) : null}

      {data.portalUnavailable ? (
        <div aria-live="assertive" className="f9-wk-notice is-error" role="alert">
          <p>
            We couldn't open your billing portal just now. Email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> or{" "}
            <Link to="/app/support?category=billing">open a billing support case</Link> and we'll handle
            the change directly.
          </p>
        </div>
      ) : null}

      {data.planChangeNotice ? (
        <PlanChangeNotice
          notice={data.planChangeNotice}
          preview={data.planChangePreview}
          selectedCycle={selectedCycle}
        />
      ) : null}
      {hasPlanChangePending && data.planChangeNotice !== "pending-change" ? (
        <PlanChangeNotice notice="pending-change" preview={null} selectedCycle={selectedCycle} />
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
        <div className="f9-wk-notice is-error" role="alert">
          <p>
            Dodo did not complete that checkout. No billing change has been applied; wait for the
            signed provider update or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need
            us to clear the pending checkout.
          </p>
        </div>
      ) : null}

      {data.annualCheckoutUnavailable ? (
        <div className="f9-wk-notice is-error" role="alert">
          <p>{dodoAnnualUnavailableCopy(selectedAnnualValidation)}</p>
        </div>
      ) : null}

      {!canManageBilling ? (
        <div className="f9-wk-notice" role="status">
          <p>
            Billing is managed by the workspace owner
            {data.billingOwnerName ? `, ${data.billingOwnerName}` : ""}. You can view usage here,
            but only the owner can change plans, buy packs, or open billing settings.
          </p>
        </div>
      ) : null}

      <article className="f9-acct-section f9-plan-picker-panel" id="plans">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">Choose inside the app</span>
            <h2>Pick a plan and billing cycle</h2>
            <p className="f9-wk-dim">
              Prices are shown in your local currency automatically. Pay annually and get{" "}
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

        {pricingUnavailable ? (
          <div className="f9-wk-notice is-error" role="status">
            <p>Prices are temporarily unavailable — try again shortly</p>
          </div>
        ) : null}

        <div className="f9-wk-plan-grid">
          {plans.map((plan) => {
            const planCyclePrice = planPrice(pricingPreview, plan.slug, selectedCycle);
            const annualValidation = annualValidationFor(pricingPreview, plan.slug);
            const annualIsValid = dodoAnnualSavingsIsValid(annualValidation);
            const annualBlocked = selectedCycle === "yearly" && !annualIsValid;
            const priceReady = Boolean(planCyclePrice);
            const planPriceUnavailable = pricingPreviewResolved && !priceReady;
            const planSaleOpen = planSaleIsOpen(commercialLaunch, plan.slug);
            const planCanUseInAppChange = plan.slug === "scout" || plan.slug === "starter";
            const isCurrentPlan = billing.plan === plan.slug;
            const isCurrentBillingChoice =
              isCurrentPlan &&
              ((billing.billingInterval === "annual" ? "yearly" : "monthly") === selectedCycle);
            const checkoutSku = billingSkuForPlanCheckout(plan.slug, selectedCycle);
            const canStartCheckout =
              canManageBilling &&
              billing.plan === "free" &&
              !isCurrentBillingChoice &&
              planSaleOpen &&
              billing.dodoStatus !== "checkout_pending" &&
              priceReady &&
              Boolean(checkoutSku) &&
              !annualBlocked;
            const canChangePlan =
              canManageBilling &&
              billing.plan !== "free" &&
              planCanUseInAppChange &&
              data.hasDodoSubscription &&
              !hasPaymentIssue &&
              !hasPlanChangePending &&
              !hasCancellationScheduled &&
              !isCurrentBillingChoice &&
              planSaleOpen &&
              billing.dodoStatus !== "checkout_pending" &&
              priceReady &&
              Boolean(checkoutSku) &&
              !annualBlocked;
            const selected = selectedPlan === plan.slug;
            // "Recommended" is advice, so it only holds while the plan is a
            // step UP for the person reading it. Pinned to Starter, it told an
            // Agency customer to downgrade.
            const recommendedForViewer =
              plan.slug === "starter" &&
              isPlanUpgrade(parsePlanFamily(billing.plan), parsePlanFamily(plan.slug));
            return (
              <section
                className={`f9-wk-plan-card${recommendedForViewer ? " is-recommended" : ""}${selected ? " is-selected" : ""}`}
                key={plan.slug}
              >
                <div className="f9-wk-plan-card-head">
                  <div>
                    <h3>
                      <span className="f9-wk-kick">{plan.name}</span>
                    </h3>
                    {planCyclePrice ? (
                      <strong>{planCyclePrice}</strong>
                    ) : planPriceUnavailable ? (
                      <strong>Price didn’t load — we’re retrying. Refresh in a moment.</strong>
                    ) : (
                      <PriceLoadingSkeleton />
                    )}
                  </div>
                  {isCurrentBillingChoice ? (
                    <Pill state="healthy">Current plan</Pill>
                  ) : isCurrentPlan ? (
                    <Pill state="healthy">Current tier</Pill>
                  ) : recommendedForViewer ? (
                    <Pill state="recommended">Recommended</Pill>
                  ) : null}
                </div>
                <p>{plan.detail}</p>
                <div className="f9-plan-limit-strip" aria-label={`${plan.name} limits`}>
                  <span>{plan.watchlistLimit ?? 0} watchlists</span>
                  <span>{plan.boardLimit ?? 0} Collections</span>
                  <span>{(plan.evidenceChecksPerMonth ?? 0).toLocaleString("en-US")} proof captures/mo</span>
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
                    <button className="f9-wk-btn-quiet" disabled type="button">
                      Owner managed
                    </button>
                  ) : isCurrentBillingChoice ? (
                    <button className="f9-wk-btn-quiet" disabled type="button">
                      Current plan
                    </button>
                  ) : planPriceUnavailable && planCanUseInAppChange ? (
                    <button className="f9-wk-btn-quiet" disabled type="button">
                      Waiting for the live price
                    </button>
                  ) : canStartCheckout && checkoutSku ? (
                    <Form action="/api/billing/dodo/checkout" method="post">
                      <input name="sku" type="hidden" value={checkoutSku} />
                      {selectedSource ? <input name="source" type="hidden" value={selectedSource} /> : null}
                      <SubmitButton
                        className={selected ? "f9-wk-btn" : "f9-acct-text-action"}
                        match={{ sku: checkoutSku }}
                        pendingLabel="Redirecting…"
                      >
                        Start {selectedCycle === "yearly" ? "annual" : "monthly"}
                      </SubmitButton>
                    </Form>
                  ) : !planCanUseInAppChange ? (
                    <Link className="f9-wk-btn-quiet" to="/app/support?category=billing">
                      Request Agency access
                    </Link>
                  ) : !planSaleOpen ? (
                    <button className="f9-wk-btn-quiet" disabled type="button">
                      {billing.plan === "free" ? "Checkout unavailable" : "Change unavailable"}
                    </button>
                  ) : canChangePlan && checkoutSku ? (
                    <Form action="/api/billing/dodo/plan-change" method="post">
                      <input name="intent" type="hidden" value="preview" />
                      <input name="sku" type="hidden" value={checkoutSku} />
                      <SubmitButton
                        className={selected ? "f9-wk-btn" : "f9-acct-text-action"}
                        intent="preview"
                        match={{ sku: checkoutSku }}
                        pendingLabel="Previewing…"
                      >
                        Preview switch
                      </SubmitButton>
                    </Form>
                  ) : billing.plan !== "free" && !data.hasDodoSubscription ? (
                    <Link className="f9-wk-btn-quiet" to="/app/support?category=billing">
                      Request billing help
                    </Link>
                  ) : billing.plan !== "free" ? (
                    hasCancellationScheduled || hasPlanChangePending || annualBlocked || !checkoutSku ? (
                      <button className="f9-wk-btn-quiet" disabled type="button">
                        {hasCancellationScheduled
                          ? "Cancellation scheduled"
                          : hasPlanChangePending
                            ? "Change pending"
                            : annualBlocked
                              ? "Annual unavailable"
                              : "Change unavailable"}
                      </button>
                    ) : hasPaymentIssue ? (
                      <Link className="f9-wk-btn-quiet" to="/app/support?category=billing">
                        Contact billing support
                      </Link>
                    ) : (
                      <PriceLoadingButton />
                    )
                  ) : annualBlocked || !checkoutSku ? (
                    <button className="f9-wk-btn-quiet" disabled type="button">
                      {annualBlocked ? "Annual unavailable" : "Checkout unavailable"}
                    </button>
                  ) : (
                    <PriceLoadingButton />
                  )}
                  {!selected && !planPriceUnavailable ? (
                    <Link
                      className="f9-wk-lnk"
                      to={billingPickerPath(plan.slug, selectedCycle, selectedSource)}
                    >
                      {/* On a paid plan every other card is a move off the
                          current one, not a first choice. */}
                      {billing.plan === "free" ? "Select" : "Switch"}
                    </Link>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </article>

      <article className="f9-acct-section">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">Plan &amp; billing</span>
            <h2>
              {planLabel} plan{isPaid ? "" : " — free account"}
            </h2>
          </div>
          {!isPaid ? (
            <Link className="f9-wk-btn" to="/app/billing?source=billing#plans">
              View plans
            </Link>
          ) : null}
        </div>

        <div className="f9-wk-worklist is-compact">
          <div className="f9-wk-workrow">
            <strong>Status</strong>
            <span>
              {formatBillingStatus(
                billing.plan,
                billing.dodoStatus,
                billing.planUpdatedAt,
                billing.hasDodoPlanChangePendingTarget,
              )}
            </span>
          </div>
          {isPaid && billing.dodoNextBillingAt ? (
            <div className="f9-wk-workrow">
              <strong>Renews on</strong>
              <span>{formatDate(billing.dodoNextBillingAt)}</span>
            </div>
          ) : null}
          {isPaid && billingCycleLabel ? (
            <div className="f9-wk-workrow">
              <strong>Billing cycle</strong>
              <span>{billingCycleLabel}</span>
            </div>
          ) : null}
          {billing.planUpdatedAt ? (
            <div className="f9-wk-workrow">
              <strong>Last billing change</strong>
              <span>{formatDate(billing.planUpdatedAt)}</span>
            </div>
          ) : null}
          <div className="f9-wk-workrow">
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
          <div className="f9-wk-workrow">
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
          <div className="f9-wk-workrow">
            <strong>Proof captures (this month)</strong>
            <span>
              {data.proofUsage.limit > 0 ? (
                <>
                  {data.proofUsage.includedUsed ?? data.proofUsage.used} of{" "}
                  {data.proofUsage.baseLimit} included used
                  {data.proofUsage.topUpRemaining && data.proofUsage.topUpRemaining > 0
                    ? ` · ${data.proofUsage.topUpRemaining} purchased proof captures remaining`
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
          <p className="f9-wk-dim">{EVIDENCE_USAGE_CUSTOMER_COPY}</p>
          {!data.proofUsage.canSpendTopUps &&
          data.proofUsage.topUpRetainedWhileInactive &&
          data.proofUsage.topUpRetainedWhileInactive > 0 ? (
            <p className="f9-wk-dim">{TOP_UP_INACTIVE_PLAN_COPY}</p>
          ) : null}
          {data.creditGrants.map((grant) => (
            <div className="f9-wk-workrow" key={`${grant.skuSlug ?? "grant"}-${grant.grantedAt}`}>
              <strong>Purchased pack</strong>
              <span>
                {grant.credits} proof captures from {topUpPackName(grant.skuSlug, grant.credits)} — never expire
              </span>
            </div>
          ))}
          <div className="f9-wk-workrow">
            <strong>Digest schedule</strong>
            <span>{digestCadenceLabel}</span>
          </div>
        </div>
      </article>

      <article className="f9-acct-section" id="top-ups">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">Proof capture packs</span>
            <h2>Top up busy weeks without changing plans</h2>
            <p className="f9-wk-dim">
              Purchased proof captures never expire and carry over until you use them. They add
              capture volume only; they do not change watchlist limits, cadence, or plan features.
            </p>
          </div>
        </div>
        <div className="f9-topup-grid">
          {bundles.map((bundle) => {
            const previewPrice = bundlePrice(pricingPreview, bundle.slug);
            const sku = bundle.sku ?? "";
            const ready = Boolean(previewPrice && sku);
            const bundlePriceUnavailable = pricingPreviewResolved && !previewPrice;
            return (
              <section className="f9-topup-card" key={bundle.slug}>
                <span className="f9-wk-kick">{bundle.creditLabel}</span>
                <h3>{bundle.name}</h3>
                {previewPrice ? (
                  <strong>{previewPrice}</strong>
                ) : bundlePriceUnavailable ? (
                  <strong>Price didn’t load — we’re retrying. Refresh in a moment.</strong>
                ) : (
                  <PriceLoadingSkeleton />
                )}
                <p>{bundle.detail}</p>
                {!canManageBilling ? (
                  <button className="f9-wk-btn-quiet" disabled type="button">
                    Owner managed
                  </button>
                ) : bundlePriceUnavailable && isPaid ? (
                  <button className="f9-wk-btn-quiet" disabled type="button">
                    Waiting for the live price
                  </button>
                ) : isPaid && ready ? (
                  <Form action="/api/billing/dodo/checkout" method="post">
                    <input name="sku" type="hidden" value={sku} />
                    {selectedSource ? <input name="source" type="hidden" value={selectedSource} /> : null}
                    <SubmitButton
                      className="f9-wk-btn-quiet"
                      match={{ sku }}
                      pendingLabel="Redirecting…"
                    >
                      Buy pack
                    </SubmitButton>
                  </Form>
                ) : isPaid && sku ? (
                  <PriceLoadingButton />
                ) : isPaid ? (
                  <button className="f9-wk-btn-quiet" disabled type="button">
                    Pack unavailable
                  </button>
                ) : (
                  <Link className="f9-wk-btn-quiet" to="/app/billing?source=top-up#plans">
                    Choose a plan first
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      </article>

      <article className="f9-acct-section">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-wk-kick">Manage billing</span>
            <h2>Change, cancel, or get invoices</h2>
          </div>
        </div>
        <div className="f9-wk-worklist is-compact">
          {!canManageBilling ? (
            <div className="f9-wk-workrow">
              <strong>Manage subscription</strong>
              <span>Owner managed</span>
            </div>
          ) : isPaid && data.hasPortal ? (
            <div className="f9-wk-workrow">
              <strong>Manage subscription</strong>
              <span>
                  Cancel anytime — email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and we'll
                  confirm your cancellation request. Open the billing portal for card and invoice
                  tasks. Use the plan cards above to switch plans or billing cycles.{" "}
                <Form action="/api/billing/dodo/portal" method="post" className="f9-wk-inline">
                  <SubmitButton className="f9-wk-btn-quiet" pendingLabel="Redirecting…">
                    Open billing portal
                  </SubmitButton>
                </Form>
              </span>
            </div>
          ) : null}
          <div className="f9-wk-workrow">
            <strong>Change or cancel your plan</strong>
            <span>
              {isPaid && data.hasPortal
                ? "Prefer support? "
                : ""}
              <Link to="/app/support?category=billing">Open a billing support case</Link> from{" "}
              {data.email}. {cancellationAccessCopy(billingLifecycleKind(billing))}
            </span>
          </div>
          <div className="f9-wk-workrow">
            <strong>Receipts and invoices</strong>
            <span>
              Dodo Payments emails a receipt for every charge. Need a copy or a GST invoice?{" "}
              <Link to="/app/support?category=billing">Open a billing support case</Link>.
            </span>
          </div>
          <div className="f9-wk-workrow">
            <strong>Refunds</strong>
            <span>
              Questions about a charge, cancellation, or refund?{" "}
              <a href={SUPPORT_MAILTO}>Email {SUPPORT_EMAIL}</a> or{" "}
              <Link to="/app/support?category=billing">open a billing support case</Link>. See the{" "}
              <Link to="/terms">current Terms</Link> for the applicable terms.
            </span>
          </div>
        </div>
      </article>
  </section>
    </DashboardPage>
  );
}

type BillingSummaryBilling = {
  plan: string;
  dodoStatus: string | null;
  dodoNextBillingAt?: string | null;
  billingInterval?: "monthly" | "annual" | null;
  planUpdatedAt?: string | null;
  hasDodoPlanChangePendingTarget?: boolean | null;
};

type BillingLifecycleKind =
  | "free"
  | "refunded"
  | "cancelled"
  | "expired"
  | "payment-issue"
  | "cancellation-scheduled"
  | "plan-change-scheduled"
  | "plan-change-pending"
  | "active";

function billingLifecycleKind(billing: BillingSummaryBilling): BillingLifecycleKind {
  // Provider terminal states win over a stale local plan label. Rendering a
  // terminal subscription as active would invite a second bad billing action
  // while reconciliation is still repairing the local row.
  if (billing.dodoStatus === "refunded") return "refunded";
  if (billing.dodoStatus === "subscription.cancelled") return "cancelled";
  if (billing.dodoStatus === "subscription.expired") return "expired";
  if (billing.plan === "free") {
    return "free";
  }
  if (PAYMENT_ISSUE_STATUSES.has(billing.dodoStatus ?? "")) return "payment-issue";
  if (billing.dodoStatus === CANCELLATION_SCHEDULED_STATUS) return "cancellation-scheduled";
  if (billing.dodoStatus === PLAN_CHANGE_SCHEDULED_STATUS) return "plan-change-scheduled";
  if (isBlockingPlanChangeStatus(
    billing.dodoStatus,
    billing.planUpdatedAt ?? null,
    billing.hasDodoPlanChangePendingTarget,
  )) {
    return "plan-change-pending";
  }
  return "active";
}

function BillingLifecycleSummary({
  billing,
  canManageBilling,
  email,
  hasPortal,
}: {
  billing: BillingSummaryBilling;
  canManageBilling: boolean;
  email: string;
  hasPortal: boolean;
}) {
  const kind = billingLifecycleKind(billing);
  const planLabel = billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1);
  const isPaid = billing.plan !== "free";
  const headingId = "billing-lifecycle-heading";

  let kicker = "Billing status";
  let title = "Plan active";
  let message: ReactNode = `${planLabel} is active.`;
  let className = "f9-checkout-banner";

  if (kind === "payment-issue") {
    kicker = "Payment issue";
    title = "Your last payment needs attention.";
    className += " is-pending";
    message = canManageBilling && hasPortal ? (
      <>
        Your {planLabel} plan is still active. Update your payment method in Dodo's hosted portal,
        or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need help. Cancellation remains
        available through billing support.
      </>
    ) : (
      <>
        Your {planLabel} plan is still active. Please check the card on the receipt email from Dodo
        Payments, or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need help.
        Cancellation remains available through billing support.
      </>
    );
  } else if (kind === "cancellation-scheduled") {
    kicker = "Cancellation scheduled";
    title = `${planLabel} will cancel at the end of this billing period.`;
    message = (
      <>
        Your {planLabel} plan remains active until the end of the current billing period
        {billing.dodoNextBillingAt ? (
          <>
            {" "}(<LocalTime fallback={billing.dodoNextBillingAt} iso={billing.dodoNextBillingAt} mode="date" />)
          </>
        ) : null}
        . After that, paid access ends and the account moves to Free.
      </>
    );
  } else if (kind === "refunded") {
    kicker = "Refunded";
    title = "Paid access has ended.";
    message = "This account is on the free plan. The refunded payment no longer provides paid-plan access.";
  } else if (kind === "cancelled") {
    kicker = "Subscription cancelled";
    title = "Paid access has ended.";
    message = "This account is on the free plan after the subscription was cancelled.";
  } else if (kind === "expired") {
    kicker = "Subscription expired";
    title = "Paid access has ended.";
    message = "This account is on the free plan after the subscription expired.";
  } else if (kind === "free") {
    kicker = "Free account";
    title = "No paid plan is active.";
    message = "Choose a plan below to start paid monitoring.";
  } else if (kind === "plan-change-scheduled") {
    kicker = "Plan change scheduled";
    title = `${planLabel} stays active until the scheduled change.`;
    message = "Your current plan remains active until Dodo applies the scheduled change.";
  } else if (kind === "plan-change-pending") {
    kicker = "Plan change pending";
    title = `${planLabel} stays active while the change is processed.`;
    message = "Dodo is processing a plan change for this subscription. Your current plan remains active.";
  }

  return (
    <article aria-labelledby={headingId} aria-live="polite" className={className}>
      <div>
        <span className="f9-wk-kick">{kicker}</span>
        <h2 id={headingId}>{title}</h2>
        <p>{message}</p>
        {kind === "payment-issue" && canManageBilling && hasPortal ? (
          <Form action="/api/billing/dodo/portal" method="post">
            <SubmitButton className="f9-wk-btn" pendingLabel="Redirecting…">
              Update payment method
            </SubmitButton>
          </Form>
        ) : kind === "free" || kind === "refunded" || kind === "cancelled" || kind === "expired" ? (
          <Link className="f9-wk-btn" to="/app/billing?source=billing#plans">
            Choose a plan
          </Link>
        ) : canManageBilling && hasPortal ? (
          <Form action="/api/billing/dodo/portal" method="post">
            <SubmitButton className="f9-wk-btn" pendingLabel="Redirecting…">
              Open billing portal
            </SubmitButton>
          </Form>
        ) : (
          <Link className="f9-wk-btn" to="/app/support?category=billing">
            Open billing support
          </Link>
        )}
      </div>
      <div className="f9-sr-only" aria-live="polite">
        {isPaid ? `Current ${planLabel} plan status: ${formatBillingStatus(
          billing.plan,
          billing.dodoStatus,
          billing.planUpdatedAt ?? null,
          billing.hasDodoPlanChangePendingTarget,
        )}.` : `Current status: ${formatBillingStatus(
          billing.plan,
          billing.dodoStatus,
          billing.planUpdatedAt ?? null,
          billing.hasDodoPlanChangePendingTarget,
        )}.`}
        {canManageBilling ? "" : ` Billing is managed by the workspace owner for ${email}.`}
      </div>
    </article>
  );
}

function cancellationAccessCopy(kind: BillingLifecycleKind) {
  if (kind === "cancellation-scheduled") {
    return "Your cancellation is scheduled; paid access remains available until the current period ends.";
  }
  if (kind === "refunded" || kind === "cancelled" || kind === "expired" || kind === "free") {
    return "Paid access has ended. Choose a plan to start again.";
  }
  if (kind === "payment-issue") {
    return "Your current plan is active while this payment issue is resolved.";
  }
  return "Cancellation stops future renewals — you keep access until the end of the period you've paid for.";
}

function PriceLoadingSkeleton() {
  return (
    <strong
      aria-atomic="true"
      aria-live="polite"
      className="f9-skeleton-line f9-skeleton-price"
      role="status"
    >
      <span className="f9-sr-only">Loading price</span>
    </strong>
  );
}

function PriceLoadingButton() {
  return (
    <button aria-busy="true" className="f9-wk-btn-quiet" disabled type="button">
      <span aria-hidden="true" className="f9-button-spinner" />
      Loading price…
    </button>
  );
}

function PlanChangeNotice({
  notice,
  preview,
  selectedCycle,
}: {
  notice: PlanChangeNoticeKind;
  preview: PlanChangePreviewNotice | null;
  selectedCycle: PricingBillingCycle;
}) {
  const cycleLabel = selectedCycle === "yearly" ? "annual" : "monthly";
  if (notice === "preview" && preview) {
    const targetCycleLabel = preview.cycle === "yearly" ? "annual" : "monthly";
    const targetPlanLabel = preview.plan.charAt(0).toUpperCase() + preview.plan.slice(1);
    const timingLabel = preview.effectiveAt === "next_billing_date"
      ? "at the next billing date"
      : "now";
    return (
      <div className="f9-wk-notice" role="status">
        <p>
          Dodo calculated {preview.charge} due now for the {targetCycleLabel} {targetPlanLabel}
          change. Confirm to apply it {timingLabel} with the saved payment method.
        </p>
        <Form action="/api/billing/dodo/plan-change" method="post">
          <input name="intent" type="hidden" value="confirm" />
          <input name="sku" type="hidden" value={preview.sku} />
          <input name="preview_token" type="hidden" value={preview.previewToken} />
          <SubmitButton
            className="f9-wk-btn"
            intent="confirm"
            match={{ sku: preview.sku }}
            pendingLabel="Confirming…"
          >
            Confirm switch
          </SubmitButton>
        </Form>
      </div>
    );
  }
  if (notice === "accepted") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>
          Dodo accepted that plan change. Your account will update here after Dodo sends the signed
          billing event.
        </p>
      </div>
    );
  }
  if (notice === "scheduled") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>
          Dodo scheduled that plan change for the next billing date. Your current plan stays active
          until then.
        </p>
      </div>
    );
  }
  if (notice === "current") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>You are already on that plan and billing cycle.</p>
      </div>
    );
  }
  if (notice === "requires-subscription") {
    return (
      <div className="f9-wk-notice is-error" role="alert">
        <p>Choose a paid plan first. After that, you can switch plans or billing cycles here.</p>
      </div>
    );
  }
  if (notice === "pending-checkout") {
    return (
      <div className="f9-wk-notice is-error" role="alert">
        <p>Finish the open Dodo checkout or wait for it to expire before changing plans.</p>
      </div>
    );
  }
  if (notice === "pending-change") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>
          This plan change is still awaiting a confirmed Dodo result. No second plan change will be
          sent while the provider outcome is unknown.
        </p>
        <div className="f9-inline-actions">
          <Form action="/api/billing/dodo/plan-change" method="post">
            <input name="intent" type="hidden" value="reconcile" />
            <SubmitButton
              className="f9-wk-btn-quiet"
              intent="reconcile"
              pendingLabel="Checking…"
            >
              Check Dodo status
            </SubmitButton>
          </Form>
          <Link className="f9-wk-lnk" to="/app/support?category=billing">
            Get billing help
          </Link>
        </div>
      </div>
    );
  }
  if (notice === "reconciled") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>Dodo confirms the plan change. Your current plan and limits now match its latest state.</p>
      </div>
    );
  }
  if (notice === "recovered") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>
          Dodo confirms no plan change was applied. The stale hold is cleared; review the price and
          confirm again if you still want to switch.
        </p>
      </div>
    );
  }
  if (notice === "status-refreshed") {
    return (
      <div className="f9-wk-notice" role="status">
        <p>Billing changed while we checked. The current provider-backed state is shown below.</p>
      </div>
    );
  }
  if (notice === "cancellation-scheduled") {
    return (
      <div className="f9-wk-notice is-error" role="alert">
        <p>Cancel the scheduled subscription cancellation before changing plans.</p>
      </div>
    );
  }
  if (notice === "payment-issue") {
    return (
      <div className="f9-wk-notice is-error" role="alert">
        <p>Update your payment method before changing plans. Dodo marked the payment as failed.</p>
      </div>
    );
  }
  return (
    <div className="f9-wk-notice is-error" role="alert">
      <p>
        Dodo could not verify that {cycleLabel} plan change just now. Your plan is unchanged. Email{" "}
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need us to handle it directly.
      </p>
    </div>
  );
}

function formatBillingStatus(
  plan: string,
  dodoStatus: string | null,
  planUpdatedAt: string | null,
  hasPlanChangePendingTarget?: boolean | null,
) {
  if (dodoStatus === "refunded") {
    return plan === "free" ? "Refunded — reverted to the free account" : "Refunded — paid access ended";
  }
  if (dodoStatus === "subscription.cancelled") {
    return plan === "free" ? "Cancelled — on the free account" : "Cancelled — paid access ended";
  }
  if (dodoStatus === "subscription.expired") {
    return plan === "free" ? "Expired — on the free account" : "Expired — paid access ended";
  }
  if (plan === "free") {
    return "Free account";
  }

  if (dodoStatus && PAYMENT_ISSUE_STATUSES.has(dodoStatus)) {
    return "Active — payment issue needs attention";
  }

  if (dodoStatus === CANCELLATION_SCHEDULED_STATUS) {
    return "Active — cancels at the end of this billing period";
  }
  if (dodoStatus === PLAN_CHANGE_SCHEDULED_STATUS) {
    return "Active — plan change scheduled";
  }
  if (isBlockingPlanChangeStatus(dodoStatus, planUpdatedAt, hasPlanChangePendingTarget)) {
    return "Active — plan change pending";
  }

  return "Active";
}

function isBlockingPlanChangeStatus(
  status: string | null,
  _planUpdatedAt: string | null,
  hasPlanChangePendingTarget?: boolean | null,
) {
  if (hasPlanChangePendingTarget) return true;
  if (status === PLAN_CHANGE_SCHEDULED_STATUS) return true;
  return status === PLAN_CHANGE_PENDING_STATUS;
}

function formatDate(value: string) {
  return <LocalTime fallback={value} iso={value} mode="date" />;
}

function topUpPackName(skuSlug: string | null | undefined, credits: number) {
  if (skuSlug && isTopUpDisplayKey(skuSlug)) {
    return TOP_UP_PACK_DISPLAY[skuSlug].name;
  }
  return `${credits.toLocaleString("en-IN")} proof-capture pack`;
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

function cleanPlanChangeNotice(value: string | null): PlanChangeNoticeKind | null {
  switch (value) {
    case "preview":
    case "accepted":
    case "scheduled":
    case "requires-subscription":
    case "unavailable":
    case "pending-checkout":
    case "pending-change":
    case "reconciled":
    case "recovered":
    case "status-refreshed":
    case "cancellation-scheduled":
    case "payment-issue":
    case "current":
    case "annual-unavailable":
      return value;
    default:
      return null;
  }
}

function cleanPlanChangePreviewTarget(params: URLSearchParams): PlanChangePreviewTarget | null {
  const plan = cleanPricingPlan(params.get("plan"));
  const cycle = coerceBillingCycle(params.get("cycle"));
  const sku = cleanSourceParam(params.get("sku"));
  const effectiveAt = cleanPlanChangeEffectiveAt(params.get("effective"));
  if ((plan !== "scout" && plan !== "starter") || !cycle || !sku || !effectiveAt) {
    return null;
  }
  if (billingSkuForPlanCheckout(plan, cycle) !== sku) return null;
  return { plan, cycle, sku, effectiveAt };
}

async function loadPlanChangePreviewNotice({
  env,
  request,
  billing,
  workspaceUserId,
  target,
  ctx,
}: {
  env: AppEnv;
  request: Request;
  billing: UserPlanBillingInfo;
  workspaceUserId: string;
  target: PlanChangePreviewTarget;
  ctx?: ExecutionContext;
}): Promise<PlanChangePreviewNotice | null> {
  if (
    billing.plan === "free" ||
    !billing.dodoSubscriptionId ||
    !billing.billingInterval ||
    billing.dodoStatus === "checkout_pending" ||
    billing.dodoStatus === CANCELLATION_SCHEDULED_STATUS ||
    isBlockingPlanChangeStatus(
      billing.dodoStatus,
      billing.planUpdatedAt,
      Boolean(billing.dodoPlanChangeProductId),
    ) ||
    PAYMENT_ISSUE_STATUSES.has(billing.dodoStatus ?? "") ||
    isCurrentBillingChoice(billing.plan, billing.billingInterval, target)
  ) {
    return null;
  }

  const {
    checkoutTargetFromSkuSlug,
    createDodoSubscriptionPlanChangePreviewToken,
    getDodo0509SubscriptionCurrency,
    previewDodo0509SubscriptionPlanChange,
    summarizeDodoSubscriptionPlanChangePreview,
  } = await import("~/lib/dodo-billing.server");
  const providerTarget = checkoutTargetFromSkuSlug(target.sku);
  if (
    providerTarget?.kind !== "plan" ||
    providerTarget.planFamily !== target.plan ||
    providerTarget.cycle !== target.cycle ||
    (providerTarget.planFamily !== "scout" && providerTarget.planFamily !== "starter")
  ) {
    return null;
  }
  const selfServeTarget = providerTarget as typeof providerTarget & {
    planFamily: "scout" | "starter";
  };

  const { validateDodo0509PlanCheckout } = await import("~/lib/dodo-pricing.server");
  const { enforceBillingProviderRateLimit } = await import("~/lib/rate-limit.server");
  const validationLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    ctx,
  );
  if (validationLimitResponse) throw validationLimitResponse;
  const validation = await validateDodo0509PlanCheckout({
    env,
    request,
    plan: selfServeTarget.planFamily,
    cycle: selfServeTarget.cycle,
  });
  if (!validation.valid) return null;

  const timing = planChangeTiming(billing.plan, billing.billingInterval, selfServeTarget);
  if (timing.effectiveAt !== target.effectiveAt) return null;

  const currencyLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    ctx,
  );
  if (currencyLimitResponse) throw currencyLimitResponse;
  const previewLimitResponse = await enforceBillingProviderRateLimit(
    request,
    env,
    workspaceUserId,
    "pricing",
    ctx,
  );
  if (previewLimitResponse) throw previewLimitResponse;
  try {
    const [subscriptionCurrency, preview] = await Promise.all([
      getDodo0509SubscriptionCurrency({
        env,
        subscriptionId: billing.dodoSubscriptionId,
      }),
      previewDodo0509SubscriptionPlanChange({
        env,
        subscriptionId: billing.dodoSubscriptionId,
        target: selfServeTarget,
        userId: workspaceUserId,
        effectiveAt: timing.effectiveAt,
        prorationBillingMode: timing.prorationBillingMode,
      }),
    ]);
    const summary = summarizeDodoSubscriptionPlanChangePreview(preview, subscriptionCurrency);
    if (!summary) return null;
    const previewToken = await createDodoSubscriptionPlanChangePreviewToken(env, {
      subscriptionId: billing.dodoSubscriptionId,
      target: selfServeTarget,
      userId: workspaceUserId,
      effectiveAt: timing.effectiveAt,
      prorationBillingMode: timing.prorationBillingMode,
      amount: summary.amount,
      currency: summary.currency,
    });
    return { ...target, charge: summary.display, previewToken };
  } catch {
    return null;
  }
}

function isCurrentBillingChoice(
  currentPlan: string,
  currentInterval: "monthly" | "annual",
  target: { plan: string; cycle: PricingBillingCycle },
) {
  const targetInterval = target.cycle === "yearly" ? "annual" : "monthly";
  return currentPlan === target.plan && currentInterval === targetInterval;
}

function planChangeTiming(
  currentPlan: "scout" | "starter" | "agency",
  currentInterval: "monthly" | "annual",
  target: { planFamily: "scout" | "starter" | "agency"; cycle: PricingBillingCycle },
) {
  const targetInterval = target.cycle === "yearly" ? "annual" : "monthly";
  const rankDelta = planRank(target.planFamily) - planRank(currentPlan);
  const upgradesValue = rankDelta > 0 || (rankDelta === 0 && currentInterval === "monthly" && targetInterval === "annual");
  if (upgradesValue) {
    return { effectiveAt: "immediately" as const, prorationBillingMode: "prorated_immediately" as const };
  }
  return { effectiveAt: "next_billing_date" as const, prorationBillingMode: "full_immediately" as const };
}

function planRank(plan: string) {
  switch (plan) {
    case "scout":
      return 1;
    case "starter":
      return 2;
    case "agency":
      return 3;
    default:
      return 0;
  }
}

function cleanPlanChangeEffectiveAt(value: string | null) {
  return value === "immediately" || value === "next_billing_date" ? value : null;
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
