import { Form, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { EVIDENCE_USAGE_CUSTOMER_COPY, TOP_UP_INACTIVE_PLAN_COPY } from "~/lib/pricing";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PAYMENT_ISSUE_STATUSES = new Set(["subscription.failed", "subscription.on_hold"]);

export const meta = () => [{ title: "Billing & usage | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Billing & usage" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const { PLAN_LIMITS, checkPlanLimit, getProofUsageSummary } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const url = new URL(request.url);
  const checkoutNotice = url.searchParams.get("checkout");
  const portalNotice = url.searchParams.get("portal");

  const { dailyProofCapForPlan } = await import("~/lib/monitoring.server");
  const { listActiveProofCreditGrants } = await import("~/lib/plan.server");
  const [billing, proofUsage, watchlistUsage, collectionUsage, creditGrants] = await Promise.all([
    getUserPlanBillingInfo(env, session.user.id),
    getProofUsageSummary(env, session.user.id),
    checkPlanLimit(env, session.user.id, "watchlists"),
    checkPlanLimit(env, session.user.id, "collections"),
    listActiveProofCreditGrants(env, session.user.id),
  ]);

  return {
    email: session.user.email,
    billing,
    proofUsage,
    watchlistUsage,
    collectionUsage,
    planLimits: PLAN_LIMITS[billing.plan],
    dailyProofCap: dailyProofCapForPlan(billing.plan, proofUsage.extraCredits),
    creditGrants,
    blockedCheckout: checkoutNotice === "already-subscribed",
    pendingCheckout: checkoutNotice === "already-started",
    agencyCheckoutHeld: checkoutNotice === "agency-held",
    planCheckoutUnavailable: checkoutNotice === "plan-unavailable",
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

      {data.agencyCheckoutHeld ? (
        <div className="f9-message is-error">
          <p>
            Agency checkout is held until nightly monitoring fan-out is proven on our internal
            workspace. Scout and Starter are available now. Email{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you need Agency capacity before then.
          </p>
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

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Plan &amp; billing</span>
            <h2>
              {planLabel} plan{isPaid ? "" : " — free account"}
            </h2>
          </div>
          {!isPaid ? (
            <Link className="f9-primary-button" to="/#pricing">
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
                  Not included on this plan — <Link to="/#pricing">view plans</Link>
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
                  Not included on this plan — <Link to="/#pricing">view plans</Link>
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
                  Not included on this plan — <Link to="/#pricing">view plans</Link>
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
                {grant.credits} evidence checks from {grant.skuSlug ?? "top-up"} — never expire
              </span>
            </div>
          ))}
          <div className="f9-work-row">
            <strong>Digest schedule</strong>
            <span>{digestCadenceLabel}</span>
          </div>
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
          {isPaid && data.hasPortal ? (
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
