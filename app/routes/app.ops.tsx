import type { ReactNode } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { LocalTime } from "~/components/local-time";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const meta = () => [{ title: "Ops | Five to Nine" }];

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
  } = await import("~/lib/data.server");
  const [snapshot, billingLifecycleResult] = await Promise.all([
    getOperatorSnapshot(env),
    listBillingLifecycleReconciliationCandidates(env)
      .then((items) => ({ items, warning: null }))
      .catch(() => ({
        items: [],
        warning: "Billing lifecycle reconciliation could not be loaded.",
      })),
  ]);

  return {
    snapshot,
    billingLifecycleCandidates: billingLifecycleResult.items,
    billingLifecycleWarning: billingLifecycleResult.warning,
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
  if (intent === "reconcile-billing-lifecycle-email") {
    const { reconcileBillingLifecycleEmailAttempt } = await import("~/lib/data.server");
    try {
      const result = await reconcileBillingLifecycleEmailAttempt(env, {
        operatorUserId: session.user.id,
        attemptId: String(formData.get("attemptId") ?? ""),
        expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
        outcome: String(formData.get("outcome") ?? "") as "sent" | "failed",
        evidenceReference: String(formData.get("evidenceReference") ?? ""),
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
      existing = await getDeliveryAttemptByIdempotencyKey(env, `support-case:${supportCase.id}`);
    }
  } catch {
    return supportAlertRecoveryUnavailable(intent);
  }
  if (!supportCase) {
    return { ok: false, intent, message: "That open support case could not be found." };
  }

  const idempotencyKey = `support-case:${supportCase.id}`;
  if (existing?.status === "sent") {
    return { ok: true, intent, message: "The operator alert was already sent." };
  }
  if (existing?.status === "pending" && existing.webhookStatus === "provider_unknown") {
    return {
      ok: false,
      intent,
      message: "Provider outcome is unknown. Check the provider console before any resend.",
    };
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
    if (finalAttempt?.status === "sent") {
      return { ok: true, intent, message: "The operator alert was already sent." };
    }
    if (finalAttempt?.status === "pending" && finalAttempt.webhookStatus === "provider_unknown") {
      return {
        ok: false,
        intent,
        message: "Provider outcome is unknown. Check the provider console before any resend.",
      };
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
  const actionData = useActionData<typeof action>();
  const warnings = [
    ...(snapshot.warnings ?? []),
    ...(billingLifecycleWarning
      ? [{ section: "billingLifecycle", message: billingLifecycleWarning }]
      : []),
  ];

  return (
    <section className="f9-app-stack">
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-app-kicker">Ops</p>
          <h2>Evidence-first monitoring health</h2>
        </div>
      </div>

      {warnings.length ? (
        <div className="f9-app-panel" role="status">
          <p className="f9-app-kicker">Partial operational view</p>
          <h3>Some operational sections could not be loaded</h3>
          {warnings.map((warning) => (
            <p className="f9-muted-copy" key={warning.section}>
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}

      {actionData ? (
        <div aria-live="polite" className="f9-app-panel" role={actionData.ok ? "status" : "alert"}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-work-list is-compact">
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
          </div>
        </article>

        <article className="f9-app-panel">
          <OpsSection
            empty="No open support cases."
            items={snapshot.supportCases ?? []}
            title="Open support cases"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{readableCode(item.priority)} priority</p>
                <h3>{item.subject}</h3>
                <p>{describeSupportAlert(item)}</p>
                {item.alert_status === "failed" || item.alert_status === null ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="retry-support-alert" />
                    <input name="caseId" type="hidden" value={item.case_id} />
                    <button className="f9-secondary-button" type="submit">
                      {item.alert_status === "failed" ? "Retry operator alert" : "Send operator alert"}
                    </button>
                  </Form>
                ) : null}
                <p className="f9-muted-copy">Updated {formatTimestamp(item.updated_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No billing lifecycle emails need provider evidence."
            items={billingLifecycleCandidates}
            title="Billing email provider reconciliation"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{formatBillingLifecycleKind(item.lifecycleKind)}</p>
                <h3>Provider outcome needs evidence</h3>
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
                      <option value="sent">Accepted or delivered</option>
                      <option value="failed">Not accepted</option>
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
                  <button className="f9-secondary-button" type="submit">
                    Record provider evidence
                  </button>
                </Form>
                <p className="f9-muted-copy">
                  Recorded {formatTimestamp(item.createdAt)}
                  {item.providerStatusLastSeenAt
                    ? <> · Provider last checked {formatTimestamp(item.providerStatusLastSeenAt)}</>
                    : null}
                </p>
              </>
            )}
          />

          <OpsSection
            empty="No failed watchlist runs in the recent window."
            items={snapshot.failingRuns}
            title="What is failing"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>Run failed</h3>
                <p>{describeRunFailure(item.error_code)}</p>
                <p className="f9-muted-copy">{formatTimestamp(item.started_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No stuck runs right now."
            items={snapshot.stuckRuns}
            title="What is stuck"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{item.status === "running" ? "Run still running" : "Run still pending"}</h3>
                <p className="f9-muted-copy">{formatTimestamp(item.started_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No failed evidence checks in the recent window."
            items={snapshot.failedProofs}
            title="Recent evidence-check failures"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{describeProofFailure(item.failure_code)}</h3>
                <p className="f9-muted-copy">{formatTimestamp(item.attempted_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No evidence checks are currently paused by budget or rate limits."
            items={snapshot.budgetBlockedProofs}
            title="What is paused by budget"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{item.status === "skipped_due_to_rate_limit" ? "Rate-limited evidence check" : "Budget-skipped evidence check"}</h3>
                <p className="f9-muted-copy">{formatTimestamp(item.attempted_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No recent delivery issues needing review."
            items={snapshot.deliveryAttention}
            title="Recent delivery attention"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name ?? "Account default"}</p>
                <h3>{item.channel === "email" ? "Email delivery" : "WhatsApp delivery"}</h3>
                <p>{describeDeliveryAttention(item)}</p>
                <p className="f9-muted-copy">{formatTimestamp(item.created_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No provider or template blockers found."
            items={snapshot.blockedTargets}
            title="What is blocked by provider or template state"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name ?? "Account default"}</p>
                <h3>WhatsApp delivery destination</h3>
                <p>{describeBlockedTarget(item)}</p>
                <p className="f9-muted-copy">{formatTimestamp(item.updated_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No recent discovery failures."
            items={snapshot.discoveryFailures}
            title="Recent discovery failures"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">
                  {formatDiscoveryProvider(item.provider)} · {formatRouteContext(item.routeContext)}
                </p>
                <h3>{item.failureClass ?? "Discovery failure"}</h3>
                <p>
                  {item.country}
                  {item.cacheStatus === "stale" ? " · stale cache served" : " · no fresh cache"}
                </p>
                <p className="f9-muted-copy">{formatTimestamp(item.createdAt)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No discovery provider state recorded yet."
            items={snapshot.discoveryProviders}
            title="Commercial discovery provider state"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{formatDiscoveryProvider(item.provider)}</p>
                <h3>{formatDiscoveryStatus(item.status)}</h3>
                <p>{describeDiscoveryProviderState(item.status)}</p>
                <p className="f9-muted-copy">
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
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{item.failed_runs + item.failed_proofs + item.failed_deliveries} recent issues</h3>
                <p>
                  {item.failed_runs} failed runs · {item.failed_proofs} failed evidence checks · {item.failed_deliveries} failed deliveries
                </p>
                <p className="f9-muted-copy">
                  {item.last_seen_at ? formatTimestamp(item.last_seen_at) : "No recent timestamp"}
                </p>
              </>
            )}
          />
        </article>
      </div>
    </section>
  );
}

function MetricCard(props: { label: string; value: number }) {
  return (
    <div className="f9-work-row">
      <p className="f9-app-kicker">{props.label}</p>
      <h3>{props.value}</h3>
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
    <section style={{ marginBottom: "1.5rem" }}>
      <p className="f9-app-kicker">{props.title}</p>
      {props.items.length === 0 ? (
        <p className="f9-muted-copy">{props.empty}</p>
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

  return "Delivery failed before provider acceptance and can be reviewed for retry.";
}

function describeSupportAlert(item: {
  alert_status: string | null;
  alert_webhook_status: string | null;
}) {
  if (item.alert_status === "sent") {
    return "Operator alert sent.";
  }
  if (item.alert_status === "failed") {
    return "Operator alert failed before acceptance and can be retried safely.";
  }
  if (item.alert_status === "pending" && item.alert_webhook_status === "provider_unknown") {
    return "Provider outcome is unknown; inspect the provider console before any resend.";
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
