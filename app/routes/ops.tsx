import type { ReactNode } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { DashboardPage } from "~/components/dashboard-page";
import { WorkingHeader } from "~/components/workspace/working-header";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { ProviderObservationTimeField } from "~/components/provider-observation-time";
import { SignOutButton } from "~/components/sign-out-button";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const meta = () => [{ title: "Ops | Five to Nine" }];

/**
 * Minimal staff shell (tri-audit G4). Ops is standalone — outside the
 * customer app — so this owns the affordances every state needs: identity
 * of the surface, a way back to the app, and sign out. All three route
 * states (page, loading, error) render inside it.
 */
function OpsShell({ children }: { children: ReactNode }) {
  return (
    <main className="f9-ops-standalone">
      <header className="f9-ops-standalone-head">
        <strong>Staff ops</strong>
        <nav aria-label="Ops">
          <Link to="/app">Back to the app</Link>
          <SignOutButton />
        </nav>
      </header>
      {children}
    </main>
  );
}

export function HydrateFallback() {
  return (
    <OpsShell>
      <DashboardRouteLoading title="Ops" />
    </OpsShell>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <OpsShell>
      <DashboardRouteError error={error} />
    </OpsShell>
  );
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  if (!isOpsUserAllowed(env, session.user.email)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const {
    getOperatorSnapshot,
    listBillingLifecycleReconciliationCandidates,
    listPendingPartialRefundReconciliations,
    listStaleDodoSubscriptionPlanChangeClaims,
  } = await import("~/lib/data.server");
  const [snapshot, billingLifecycleResult, planChangeResult, partialRefundResult] = await Promise.all([
    getOperatorSnapshot(env),
    listBillingLifecycleReconciliationCandidates(env)
      .then((items) => ({ items, warning: null }))
      .catch(() => ({
        items: [],
        warning: "Billing lifecycle reconciliation could not be loaded.",
      })),
    listStaleDodoSubscriptionPlanChangeClaims(env, { limit: 50 })
      .then((items) => ({ items, warning: null }))
      .catch(() => ({
        items: [],
        warning: "Plan-change reconciliation could not be loaded.",
      })),
    listPendingPartialRefundReconciliations(env)
      .then((items) => ({ items, warning: null }))
      .catch(() => ({
        items: [],
        warning: "Partial refund reconciliation could not be loaded.",
      })),
  ]);

  return {
    snapshot,
    billingLifecycleCandidates: billingLifecycleResult.items,
    billingLifecycleWarning: billingLifecycleResult.warning,
    stalePlanChangeClaims: planChangeResult.items,
    planChangeWarning: planChangeResult.warning,
    pendingPartialRefundReconciliations: partialRefundResult.items,
    partialRefundWarning: partialRefundResult.warning,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  if (!isOpsUserAllowed(env, session.user.email)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent === "reconcile-partial-refund") {
    const { reconcilePartialRefundWithAudit } = await import("~/lib/data.server");
    try {
      const result = await reconcilePartialRefundWithAudit(env, {
        operatorUserId: session.user.id,
        eventId: String(formData.get("eventId") ?? ""),
        expectedProcessedAt: String(formData.get("expectedProcessedAt") ?? ""),
        decision: String(formData.get("decision") ?? "") as "retain" | "revoke",
        creditQuantityToRevoke: Number(String(formData.get("creditQuantityToRevoke") ?? "")),
        evidenceReference: String(formData.get("evidenceReference") ?? ""),
        observedAt: String(formData.get("observedAt") ?? ""),
      });
      if (result.reconciled) {
        return {
          ok: true,
          intent,
          message: result.decision === "revoke"
            ? `${result.appliedQuantity} proof credits were revoked with provider evidence. No provider refund request was sent.`
            : "The partial refund was reviewed and existing proof credits were retained. No provider refund request was sent.",
        };
      }
      return {
        ok: false,
        intent,
        message: result.reason === "grant_unavailable"
          ? "No matching proof-credit grant is available. Refresh and verify the payment before retrying."
          : result.reason === "idempotency_conflict"
            ? "This refund already has different reconciliation evidence. Refresh before making another decision."
            : "That refund changed or is not eligible. Refresh and verify the provider evidence.",
      };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          ok: false,
          intent,
          message: "Choose a valid decision, credit quantity, provider observation time, and private evidence reference.",
        };
      }
      throw error;
    }
  }
  if (intent === "reconcile-dodo-plan-change") {
    const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
    if (!subjectUserId) {
      return {
        ok: false,
        intent,
        message: "This recovery request is incomplete. Refresh the operator desk.",
      };
    }
    const { reconcileDodo0509SubscriptionPlanChange } = await import(
      "~/lib/dodo-plan-change-reconciliation.server"
    );
    const result = await reconcileDodo0509SubscriptionPlanChange({
      env,
      subjectUserId,
      actorUserId: session.user.id,
    });
    if (result.ok) {
      const outcomeMessage = result.outcome === "accepted"
        ? "Dodo confirms the new plan; local entitlements were reconciled."
        : result.outcome === "scheduled"
          ? "Dodo confirms a scheduled plan change; current entitlements remain active until then."
          : result.outcome === "unchanged"
            ? "Dodo confirms the old plan is still active; the stale hold was cleared."
            : "Dodo truth is still unavailable; the claim remains safely blocked for follow-up.";
      return {
        ok: true,
        intent,
        subjectUserId,
        message: `${outcomeMessage} No second plan change was sent.`,
      };
    }
    return {
      ok: false,
      intent,
      subjectUserId,
      message: result.reason === "not_due"
        ? "This plan change is not yet eligible for provider reconciliation. Refresh and retry later."
        : "The billing row changed during recovery. Refresh before checking again.",
    };
  }
  if (intent === "reconcile-billing-lifecycle-email") {
    const { reconcileBillingLifecycleEmailAttempt } = await import("~/lib/data.server");
    try {
      const result = await reconcileBillingLifecycleEmailAttempt(env, {
        operatorUserId: session.user.id,
        attemptId: String(formData.get("attemptId") ?? ""),
        expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
        outcome: String(formData.get("outcome") ?? "") as "sent" | "failed",
        evidenceClassification: String(formData.get("evidenceClassification") ?? "") as
          | "controlled_inbox_receipt"
          | "provider_acceptance_log"
          | "provider_delivery_confirmation"
          | "provider_rejection_log",
        evidenceReference: String(formData.get("evidenceReference") ?? ""),
        observedAt: String(formData.get("observedAt") ?? ""),
        providerMessageId: String(formData.get("providerMessageId") ?? "").trim() || null,
      });

      return result.reconciled
        ? {
            ok: true,
            intent,
            message: "Provider evidence was recorded and the billing email outcome is now final.",
          }
        : {
            ok: false,
            intent,
            message: "That attempt changed or is not eligible. Refresh and re-check the provider evidence.",
          };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          ok: false,
          intent,
          message: "Add a valid provider evidence reference and choose the confirmed outcome.",
        };
      }
      throw error;
    }
  }

  if (intent === "reconcile-support-alert") {
    const {
      createSupportAlertReconciliationKey,
      reconcileSupportAlertAttemptWithAudit,
    } = await import("~/lib/data/operator-delivery-reconciliation.server");
    try {
      const result = await reconcileSupportAlertAttemptWithAudit(env, {
        operatorUserId: session.user.id,
        attemptId: String(formData.get("attemptId") ?? ""),
        idempotencyKey: createSupportAlertReconciliationKey(),
        expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
        outcome: String(formData.get("outcome") ?? "") as "sent" | "failed",
        classification: String(formData.get("classification") ?? "") as
          | "cloudflare_email_log"
          | "controlled_inbox_receipt"
          | "provider_rejection_log",
        evidenceReference: String(formData.get("evidenceReference") ?? ""),
        observedAt: String(formData.get("observedAt") ?? ""),
      });
      return result.ok
        ? {
            ok: true,
            intent,
            message: result.outcome === "sent"
              ? "Provider acceptance was recorded. No email was resent."
              : "Provider rejection was recorded. No email was resent; one safe retry is now available.",
          }
        : {
            ok: false,
            intent,
            message: "That alert changed or the evidence is incomplete. Refresh and verify the provider record.",
          };
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          ok: false,
          intent,
          message: "Add a valid private evidence reference, observation time, and confirmed outcome.",
        };
      }
      throw error;
    }
  }

  if (intent !== "retry-support-alert") {
    return { ok: false, intent, message: "Unknown operator action." };
  }

  const caseId = String(formData.get("caseId") ?? "").trim();
  if (!caseId || caseId.length > 120) {
    return { ok: false, intent, message: "Choose a valid support case." };
  }

  const { getDeliveryAttemptByIdempotencyKey, getOperatorSupportCase } = await import(
    "~/lib/data.server"
  );
  let supportCase;
  let existing;
  try {
    supportCase = await getOperatorSupportCase(env, caseId);
    if (supportCase) {
      existing = await getDeliveryAttemptByIdempotencyKey(
        env,
        supportCase.alertIdempotencyKey ?? `support-case:${supportCase.id}`,
      );
    }
  } catch {
    return supportAlertRecoveryUnavailable(intent);
  }
  if (!supportCase) {
    return { ok: false, intent, message: "That open support case could not be found." };
  }

  const idempotencyKey =
    supportCase.alertIdempotencyKey ?? `support-case:${supportCase.id}`;
  if (existing?.webhookStatus === "provider_unknown") {
    return {
      ok: false,
      intent,
      message: "Provider outcome is unknown. Check the provider console before any resend.",
    };
  }
  if (existing?.status === "sent") {
    return { ok: true, intent, message: "The operator alert was already sent." };
  }
  if (existing?.status === "pending") {
    return { ok: false, intent, message: "The operator alert already has an active dispatch claim." };
  }

  let sent = false;
  try {
    const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
    sent = await sendOperatorAlertEmail(env, {
      subject: `0509 support case: ${supportCase.subject}`,
      lines: [
        `Case: ${supportCase.id}`,
        `Requester: ${supportCase.userEmail}`,
        `Category: ${readableCode(supportCase.category)}`,
        `Priority: ${readableCode(supportCase.priority)}`,
        `Subject: ${supportCase.subject}`,
        `Details: ${supportCase.detail}`,
      ],
      idempotencyKey,
    });
  } catch {
    sent = false;
  }
  if (sent) {
    return { ok: true, intent, message: "The support alert was sent and recorded." };
  }

  try {
    const finalAttempt = await getDeliveryAttemptByIdempotencyKey(env, idempotencyKey);
    if (finalAttempt?.webhookStatus === "provider_unknown") {
      return {
        ok: false,
        intent,
        message: "Provider outcome is unknown. Check the provider console before any resend.",
      };
    }
    if (finalAttempt?.status === "sent") {
      return { ok: true, intent, message: "The operator alert was already sent." };
    }
    if (finalAttempt?.status === "pending") {
      return {
        ok: false,
        intent,
        message: "The operator alert already has an active dispatch claim.",
      };
    }
  } catch {
    return supportAlertRecoveryUnavailable(intent);
  }

  return {
    ok: false,
    intent,
    message: "The support alert was not sent. Its durable attempt remains available for review.",
  };
}

function supportAlertRecoveryUnavailable(intent: string) {
  return {
    ok: false,
    intent,
    message: "Support alert recovery is temporarily unavailable. Refresh before trying again.",
  };
}

export default function OpsRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const { snapshot } = loaderData;
  const billingLifecycleCandidates = loaderData.billingLifecycleCandidates ?? [];
  const billingLifecycleWarning = loaderData.billingLifecycleWarning ?? null;
  const stalePlanChangeClaims = loaderData.stalePlanChangeClaims ?? [];
  const planChangeWarning = loaderData.planChangeWarning ?? null;
  const pendingPartialRefundReconciliations =
    loaderData.pendingPartialRefundReconciliations ?? [];
  const partialRefundWarning = loaderData.partialRefundWarning ?? null;
  const actionData = useActionData<typeof action>();
  const warnings = [
    ...(snapshot.warnings ?? []),
    ...(billingLifecycleWarning
      ? [{ section: "billingLifecycle", message: billingLifecycleWarning }]
      : []),
    ...(planChangeWarning
      ? [{ section: "planChange", message: planChangeWarning }]
      : []),
    ...(partialRefundWarning
      ? [{ section: "partialRefundReconciliation", message: partialRefundWarning }]
      : []),
  ];

  return (
    <OpsShell>
    <DashboardPage>
    <section className="f9-wk-stack">
      <WorkingHeader
        context="Evidence-first monitoring health for failing runs, stuck jobs, and delivery issues."
        title="Ops"
      />

      {warnings.length ? (
        <div className="f9-wk-panel" role="status">
          <p className="f9-wk-kick">Partial operational view</p>
          <h2>Some operational sections could not be loaded</h2>
          {warnings.map((warning) => (
            <p className="f9-wk-dim" key={warning.section}>
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}

      {actionData ? (
        <div aria-live="polite" className="f9-wk-panel" role={actionData.ok ? "status" : "alert"}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <div className="f9-wk-grid2">
        <article className="f9-wk-panel f9-side-panel">
          <div className="f9-wk-worklist is-compact">
            <MetricCard label="Failing runs" value={snapshot.summary.failingRuns} />
            <MetricCard label="Stuck runs" value={snapshot.summary.stuckRuns} />
            <MetricCard label="Failed evidence checks" value={snapshot.summary.failedProofs} />
            <MetricCard label="Budget-blocked evidence checks" value={snapshot.summary.budgetBlockedProofs} />
            <MetricCard label="Blocked targets" value={snapshot.summary.blockedTargets} />
            <MetricCard label="Delivery attention" value={snapshot.summary.deliveryAttention} />
            <MetricCard label="Degraded watchlists" value={snapshot.summary.degradedWatchlists} />
            <MetricCard label="Discovery failures" value={snapshot.summary.discoveryFailures} />
            <MetricCard
              label="Discovery providers needing attention"
              value={snapshot.summary.discoveryProvidersNeedingAttention}
            />
            <MetricCard label="Open support cases" value={snapshot.summary.openSupportCases ?? 0} />
            <MetricCard
              label="Support alerts needing retry"
              value={snapshot.summary.supportAlertsNeedRetry ?? 0}
            />
            <MetricCard
              label="Billing emails needing evidence"
              value={billingLifecycleCandidates.length}
            />
            <MetricCard
              label="Plan changes needing provider check"
              value={stalePlanChangeClaims.length}
            />
            <MetricCard
              label="Partial refunds needing review"
              value={pendingPartialRefundReconciliations.length}
            />
          </div>
        </article>

        <article className="f9-wk-panel">
          <OpsSection
            empty="No open support cases."
            items={snapshot.supportCases ?? []}
            title="Open support cases"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{readableCode(item.priority)} priority</p>
                <h2>{item.subject}</h2>
                <p>{describeSupportAlert(item)}</p>
                {item.alert_webhook_status === "provider_unknown" &&
                item.alert_attempt_id &&
                item.alert_updated_at ? (
                  <Form className="f9-auth-form" method="post">
                    <input name="intent" type="hidden" value="reconcile-support-alert" />
                    <input name="attemptId" type="hidden" value={item.alert_attempt_id} />
                    <input name="expectedUpdatedAt" type="hidden" value={item.alert_updated_at} />
                    <label className="f9-field">
                      <span>Confirmed provider outcome</span>
                      <select defaultValue="" name="outcome" required>
                        <option disabled value="">Choose an outcome</option>
                        <option value="sent">Accepted or delivered</option>
                        <option value="failed">Not accepted</option>
                      </select>
                    </label>
                    <label className="f9-field">
                      <span>Evidence classification</span>
                      <select defaultValue="" name="classification" required>
                        <option disabled value="">Choose evidence</option>
                        <option value="controlled_inbox_receipt">Controlled inbox receipt</option>
                        <option value="cloudflare_email_log">Cloudflare Email log</option>
                        <option value="provider_rejection_log">Provider rejection log</option>
                      </select>
                    </label>
                    <label className="f9-field">
                      <span>Private evidence reference</span>
                      <input maxLength={160} name="evidenceReference" required />
                    </label>
                    <ProviderObservationTimeField />
                    <button className="f9-wk-btn-quiet" type="submit">
                      Record provider evidence
                    </button>
                  </Form>
                ) : item.alert_status === "failed" || item.alert_status === null ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="retry-support-alert" />
                    <input name="caseId" type="hidden" value={item.case_id} />
                    <button className="f9-wk-btn-quiet" type="submit">
                      {item.alert_status === "failed" ? "Retry operator alert" : "Send operator alert"}
                    </button>
                  </Form>
                ) : null}
                <p className="f9-wk-dim">Updated {formatTimestamp(item.updated_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No billing lifecycle emails need provider evidence."
            items={billingLifecycleCandidates}
            title="Billing email provider reconciliation"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{formatBillingLifecycleKind(item.lifecycleKind)}</p>
                <h2>Provider outcome needs evidence</h2>
                <p>
                  Record only a confirmed provider outcome. This action never resends an email and does not expose the
                  recipient or message body.
                </p>
                <Form className="f9-auth-form" method="post">
                  <input name="intent" type="hidden" value="reconcile-billing-lifecycle-email" />
                  <input name="attemptId" type="hidden" value={item.attemptId} />
                  <input name="expectedUpdatedAt" type="hidden" value={item.updatedAt} />
                  <label className="f9-field">
                    <span>Confirmed provider outcome</span>
                    <select defaultValue="" name="outcome" required>
                      <option disabled value="">Choose an outcome</option>
                      <option value="sent">
                        {item.status === "sent" ? "Confirmed delivered" : "Accepted or delivered"}
                      </option>
                      <option value="failed">Not accepted</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Evidence classification</span>
                    <select defaultValue="" name="evidenceClassification" required>
                      <option disabled value="">Choose evidence</option>
                      <option value="controlled_inbox_receipt">Controlled inbox receipt</option>
                      {item.status === "pending" ? (
                        <option value="provider_acceptance_log">Provider acceptance log</option>
                      ) : null}
                      <option value="provider_delivery_confirmation">Provider delivery confirmation</option>
                      <option value="provider_rejection_log">Provider rejection log</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Private evidence reference</span>
                    <input maxLength={512} name="evidenceReference" required />
                  </label>
                  <label className="f9-field">
                    <span>Provider message ID (optional)</span>
                    <input maxLength={255} name="providerMessageId" />
                  </label>
                  <ProviderObservationTimeField />
                  <button className="f9-wk-btn-quiet" type="submit">
                    Record provider evidence
                  </button>
                </Form>
                <p className="f9-wk-dim">
                  Recorded {formatTimestamp(item.createdAt)}
                  {item.providerStatusLastSeenAt
                    ? <> · Provider last checked {formatTimestamp(item.providerStatusLastSeenAt)}</>
                    : null}
                </p>
              </>
            )}
          />

          <OpsSection
            empty="No stale plan changes are awaiting provider reconciliation."
            items={stalePlanChangeClaims}
            title="Plan changes awaiting provider reconciliation"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.plan} plan · provider outcome unknown</p>
                <h2>Subscription plan change needs a current-state check</h2>
                <p>
                  Read Dodo's current subscription state and reconcile it atomically. This action
                  never sends another plan-change request.
                </p>
                <p className="f9-wk-dim">
                  Account {maskIdentifier(item.userId)} · waiting since {formatTimestamp(item.claimedAt)}
                </p>
                <Form method="post">
                  <input name="intent" type="hidden" value="reconcile-dodo-plan-change" />
                  <input name="subjectUserId" type="hidden" value={item.userId} />
                  <button className="f9-wk-btn-quiet" type="submit">
                    Check current Dodo state
                  </button>
                </Form>
              </>
            )}
          />

          <OpsSection
            empty="No partial refunds are awaiting operator reconciliation."
            items={pendingPartialRefundReconciliations}
            title="Partial refunds awaiting operator reconciliation"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">Partial provider refund · {maskIdentifier(item.eventId)}</p>
                <h2>Proof-credit decision needs provider evidence</h2>
                <p>
                  Record whether existing proof credits should be retained or revoked. This action
                  never sends another refund request to the provider.
                </p>
                <p className="f9-wk-dim">
                  {item.availableCredits} proof credits currently available · processed {formatTimestamp(item.processedAt)}
                </p>
                <Form className="f9-auth-form" method="post">
                  <input name="intent" type="hidden" value="reconcile-partial-refund" />
                  <input name="eventId" type="hidden" value={item.eventId} />
                  <input name="expectedProcessedAt" type="hidden" value={item.processedAt} />
                  <label className="f9-field">
                    <span>Credit decision</span>
                    <select defaultValue="" name="decision" required>
                      <option disabled value="">Choose a decision</option>
                      <option value="retain">Retain existing proof credits</option>
                      <option value="revoke">Revoke confirmed proof credits</option>
                    </select>
                  </label>
                  <label className="f9-field">
                    <span>Proof credits to revoke (0 when retaining)</span>
                    <input
                      defaultValue={0}
                      max={Math.max(0, item.availableCredits)}
                      min={0}
                      name="creditQuantityToRevoke"
                      required
                      step={1}
                      type="number"
                    />
                  </label>
                  <label className="f9-field">
                    <span>Private evidence reference</span>
                    <input maxLength={512} name="evidenceReference" required />
                  </label>
                  <ProviderObservationTimeField />
                  <button className="f9-wk-btn-quiet" type="submit">
                    Record refund reconciliation
                  </button>
                </Form>
              </>
            )}
          />

          <OpsSection
            empty="No failed watchlist runs in the recent window."
            items={snapshot.failingRuns}
            title="What is failing"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name}</p>
                <h2>Run failed</h2>
                <p>{describeRunFailure(item.error_code)}</p>
                <p className="f9-wk-dim">{formatTimestamp(item.started_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No stuck runs right now."
            items={snapshot.stuckRuns}
            title="What is stuck"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name}</p>
                <h2>{item.status === "running" ? "Run still running" : "Run still pending"}</h2>
                <p className="f9-wk-dim">{formatTimestamp(item.started_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No failed evidence checks in the recent window."
            items={snapshot.failedProofs}
            title="Recent evidence-check failures"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name}</p>
                <h2>{describeProofFailure(item.failure_code)}</h2>
                <p className="f9-wk-dim">{formatTimestamp(item.attempted_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No evidence checks are currently paused by budget or rate limits."
            items={snapshot.budgetBlockedProofs}
            title="What is paused by budget"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name}</p>
                <h2>{item.status === "skipped_due_to_rate_limit" ? "Rate-limited evidence check" : "Budget-skipped evidence check"}</h2>
                <p className="f9-wk-dim">{formatTimestamp(item.attempted_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No recent delivery issues needing review."
            items={snapshot.deliveryAttention}
            title="Recent delivery attention"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name ?? "Account default"}</p>
                <h2>{item.channel === "email" ? "Email delivery" : "WhatsApp delivery"}</h2>
                <p>{describeDeliveryAttention(item)}</p>
                <p className="f9-wk-dim">{formatTimestamp(item.created_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No provider or template blockers found."
            items={snapshot.blockedTargets}
            title="What is blocked by provider or template state"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name ?? "Account default"}</p>
                <h2>WhatsApp delivery destination</h2>
                <p>{describeBlockedTarget(item)}</p>
                <p className="f9-wk-dim">{formatTimestamp(item.updated_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No recent discovery failures."
            items={snapshot.discoveryFailures}
            title="Recent discovery failures"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">
                  {formatDiscoveryProvider(item.provider)} · {formatRouteContext(item.routeContext)}
                </p>
                <h2>
                  {item.partial ? "Partial discovery result" : item.failureClass ?? "Discovery failure"}
                </h2>
                <p>
                  {item.partial
                    ? (
                        <>
                          Any first-page results were retained; later-page retrieval failed.
                          {item.failureClass ? ` Failure class: ${item.failureClass}.` : ""}
                        </>
                      )
                    : `${item.country}${item.cacheStatus === "stale" ? " · stale cache served" : " · no fresh cache"}`}
                </p>
                <p className="f9-wk-dim">{formatTimestamp(item.createdAt)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No discovery provider state recorded yet."
            items={snapshot.discoveryProviders}
            title="Commercial discovery provider state"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{formatDiscoveryProvider(item.provider)}</p>
                <h2>{item.partial ? "Partial results retained" : formatDiscoveryStatus(item.status)}</h2>
                <p>
                  {item.partial
                    ? "Any retained first-page results remain usable, but later-page retrieval is degraded."
                    : describeDiscoveryProviderState(item.status)}
                </p>
                <p className="f9-wk-dim">
                  {item.lastFailureAt ? (
                    <>Last failure {formatTimestamp(item.lastFailureAt)}</>
                  ) : item.lastSuccessAt ? (
                    <>Last success {formatTimestamp(item.lastSuccessAt)}</>
                  ) : (
                    <>Last updated {formatTimestamp(item.updatedAt)}</>
                  )}
                  {item.failureClass ? ` · ${item.failureClass}` : ""}
                </p>
              </>
            )}
          />

          <OpsSection
            empty="No degraded watchlists in the recent window."
            items={snapshot.degradedWatchlists}
            title="Which watchlists are degraded right now"
            renderItem={(item) => (
              <>
                <p className="f9-wk-kick">{item.watchlist_name}</p>
                <h2>{item.failed_runs + item.failed_proofs + item.failed_deliveries} recent issues</h2>
                <p>
                  {item.failed_runs} failed runs · {item.failed_proofs} failed evidence checks · {item.failed_deliveries} failed deliveries
                </p>
                <p className="f9-wk-dim">
                  {item.last_seen_at ? formatTimestamp(item.last_seen_at) : "No recent timestamp"}
                </p>
              </>
            )}
          />
        </article>
      </div>
    </section>
    </DashboardPage>
    </OpsShell>
  );
}

function MetricCard(props: { label: string; value: number }) {
  return (
    <div className="f9-wk-workrow">
      <p className="f9-wk-kick">{props.label}</p>
      <p className="f9-ops-metric-value">{props.value}</p>
    </div>
  );
}

function OpsSection<T>(props: {
  title: string;
  items: T[];
  empty: string;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <section className="f9-wk-mb15">
      <p className="f9-wk-kick">{props.title}</p>
      {props.items.length === 0 ? (
        <p className="f9-wk-dim">{props.empty}</p>
      ) : (
        <ul className="event-list">
          {props.items.map((item, index) => (
            <li className="f9-event-card" key={index}>
              {props.renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describeBlockedTarget(item: {
  is_opted_in: number;
  is_validated: number;
  is_paused: number;
  template_eligible: number;
}) {
  if (item.is_opted_in === 0) {
    return "WhatsApp target is not opted in.";
  }
  if (item.is_validated === 0) {
    return "WhatsApp target is not validated.";
  }
  if (item.is_paused === 1) {
    return "WhatsApp target is paused.";
  }
  if (item.template_eligible === 0) {
    return "WhatsApp target is not template-eligible.";
  }
  return "WhatsApp target is blocked for an operational reason.";
}

function describeDeliveryAttention(item: {
  status: string;
  webhook_status: string;
}) {
  if (item.status === "pending" && item.webhook_status === "provider_unknown") {
    return "Provider outcome is unknown. Check the provider console before deciding whether a retry is safe.";
  }
  if (item.status === "sent" && item.webhook_status === "provider_unknown") {
    return "Provider accepted this email, but final delivery is still unconfirmed. Check the provider console; do not resend it.";
  }

  return "Delivery failed before provider acceptance and can be reviewed for retry.";
}

function describeSupportAlert(item: {
  alert_status: string | null;
  alert_webhook_status: string | null;
}) {
  if (item.alert_webhook_status === "provider_unknown") {
    if (item.alert_status === "sent") {
      return "Provider accepted this operator alert, but final delivery is still unconfirmed. Check the provider console; do not resend it.";
    }
    return "Provider outcome is unknown; inspect the provider console before any resend.";
  }
  if (item.alert_status === "sent") {
    return "Operator alert sent.";
  }
  if (item.alert_status === "failed") {
    return "Operator alert failed before acceptance and can be retried safely.";
  }
  if (item.alert_status === "pending") {
    return "Operator alert dispatch is in progress.";
  }
  return "No operator alert attempt has been recorded yet.";
}

function describeRunFailure(code: string | null) {
  return code ? `Run failure category: ${readableCode(code)}.` : "The run failed for an operational reason.";
}

function formatBillingLifecycleKind(
  value: "payment_issue" | "cancellation_scheduled" | "access_ended" | "refund_revoked",
) {
  switch (value) {
    case "payment_issue":
      return "Payment issue email";
    case "cancellation_scheduled":
      return "Cancellation scheduled email";
    case "access_ended":
      return "Access ended email";
    case "refund_revoked":
      return "Refund and access email";
  }
}

function describeProofFailure(code: string | null) {
  return code ? `Evidence check: ${readableCode(code)}` : "Evidence check failed";
}

function describeDiscoveryProviderState(status: string) {
  return status === "healthy"
    ? "Recent provider state is healthy."
    : "Provider state needs operator review; customer-facing source status remains the source of truth.";
}

function readableCode(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function formatTimestamp(value: string) {
  return <LocalTime iso={value} />;
}

function maskIdentifier(value: string) {
  const normalized = value.trim();
  if (normalized.length <= 8) return "••••";
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
}

function formatDiscoveryProvider(provider: string) {
  if (provider === "meta_library_browser") {
    return "Browser Run";
  }
  if (provider === "meta_api") {
    return "Meta API";
  }
  if (provider === "demo") {
    return "Demo";
  }
  return provider;
}

function formatRouteContext(routeContext: string) {
  if (routeContext === "watchlist_scan") {
    return "Watchlist scan";
  }
  if (routeContext === "scheduled_warmup") {
    return "Scheduled warmup";
  }
  return "Public search";
}

function formatDiscoveryStatus(status: string) {
  return status.replaceAll("_", " ");
}
