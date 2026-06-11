import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const PAYMENT_ISSUE_STATUSES = new Set(["subscription.failed", "subscription.on_hold"]);

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const { PLAN_LIMITS, checkPlanLimit, getProofUsageSummary } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const checkoutNotice = new URL(request.url).searchParams.get("checkout");

  const [billing, proofUsage, watchlistUsage, collectionUsage] = await Promise.all([
    getUserPlanBillingInfo(env, session.user.id),
    getProofUsageSummary(env, session.user.id),
    checkPlanLimit(env, session.user.id, "watchlists"),
    checkPlanLimit(env, session.user.id, "collections"),
  ]);

  return {
    email: session.user.email,
    billing,
    proofUsage,
    watchlistUsage,
    collectionUsage,
    planLimits: PLAN_LIMITS[billing.plan],
    blockedCheckout: checkoutNotice === "already-subscribed",
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
    <section className="f9-app-stack">
      {data.blockedCheckout ? (
        <div className="f9-message is-error">
          <p>
            You already have an active {planLabel} plan, so we stopped that checkout — finishing it
            would have started a second, overlapping subscription. To switch plans or change billing,
            email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email} and we'll handle it
            the same day.
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
              {planLabel} plan{isPaid ? "" : " — free workspace"}
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
          {billing.planUpdatedAt ? (
            <div className="f9-work-row">
              <strong>Last billing change</strong>
              <span>{formatDate(billing.planUpdatedAt)}</span>
            </div>
          ) : null}
          <div className="f9-work-row">
            <strong>Competitor watchlists</strong>
            <span>
              {data.watchlistUsage.current} of {data.watchlistUsage.limit} used
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Collections</strong>
            <span>
              {data.collectionUsage.current} of {data.collectionUsage.limit} used
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Evidence checks (30 days)</strong>
            <span>
              {data.proofUsage.used} of {data.proofUsage.limit} used
              {data.proofUsage.extraCredits > 0
                ? ` (includes ${data.proofUsage.extraCredits} purchased credits)`
                : ""}
            </span>
          </div>
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
          <div className="f9-work-row">
            <strong>Change or cancel your plan</strong>
            <span>
              Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from {data.email}. Cancellation
              stops future renewals — you keep access until the end of the period you've paid for.
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Receipts and invoices</strong>
            <span>
              Dodo Payments emails a receipt for every charge. Need a copy or a GST invoice? Email{" "}
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
            </span>
          </div>
          <div className="f9-work-row">
            <strong>Refunds</strong>
            <span>
              Refund requests follow the <Link to="/terms">terms of service</Link>. Email support and
              include the receipt — refunded plans revert to the free workspace.
            </span>
          </div>
        </div>
      </article>
    </section>
  );
}

function formatBillingStatus(plan: string, dodoStatus: string | null) {
  if (plan === "free") {
    if (dodoStatus === "refunded") return "Refunded — reverted to the free workspace";
    if (dodoStatus === "subscription.cancelled") return "Cancelled — on the free workspace";
    if (dodoStatus === "subscription.expired") return "Expired — on the free workspace";
    return "Free workspace";
  }

  if (dodoStatus && PAYMENT_ISSUE_STATUSES.has(dodoStatus)) {
    return "Active — payment retry in progress";
  }

  return "Active";
}

function formatDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(time));
}
