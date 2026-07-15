import type { ReactNode } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { LocalTime } from "~/components/local-time";
import { ActionFeedback } from "~/components/action-feedback";
import { SubmitButton } from "~/components/submit-button";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const meta = () => [{ title: "Ops | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { env } = await requireOpsAccess(context, request);
  const {
    createBillingEmailReconciliationKey,
    getOperatorSnapshot,
    listOutstandingBillingLifecycleProviderUnknownAttempts,
  } = await import("~/lib/data.server");
  const [rawSnapshot, outstandingBillingAttempts] = await Promise.all([
    getOperatorSnapshot(env),
    listOutstandingBillingLifecycleProviderUnknownAttempts(env, { limit: 50 }),
  ]);
  const snapshot = maskOperatorSnapshot(rawSnapshot);

  return {
    snapshot,
    outstandingBillingAttempts: outstandingBillingAttempts.map((attempt) => ({
      attemptId: attempt.id,
      recipient: maskDeliveryTarget(attempt.targetValue),
      templateName: attempt.templateName,
      provider: attempt.provider,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      reconciliationKey: createBillingEmailReconciliationKey(),
    })),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { env, session } = await requireOpsAccess(context, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent !== "reconcile-billing-email") {
    return { ok: false, intent, message: "Unknown operator action." };
  }

  const { BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS, reconcileBillingEmailAttemptWithAudit } =
    await import("~/lib/data.server");
  const classificationValue = String(formData.get("classification") ?? "");
  const classification = BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS.find(
    (value) => value === classificationValue,
  );
  if (!classification) {
    return {
      ok: false,
      intent,
      attemptId: String(formData.get("attemptId") ?? ""),
      message: "Choose a supported provider-evidence classification.",
    };
  }
  const outcomeValue = String(formData.get("outcome") ?? "");
  const outcome = outcomeValue === "sent" || outcomeValue === "failed" ? outcomeValue : null;
  if (!outcome) {
    return {
      ok: false,
      intent,
      attemptId: String(formData.get("attemptId") ?? ""),
      message: "Choose the provider-confirmed outcome.",
    };
  }

  const result = await reconcileBillingEmailAttemptWithAudit(env, {
    operatorUserId: session.user.id,
    attemptId: String(formData.get("attemptId") ?? ""),
    idempotencyKey: String(formData.get("reconciliationKey") ?? ""),
    expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
    outcome,
    classification,
    evidenceReference: String(formData.get("evidenceReference") ?? ""),
    observedAt: String(formData.get("observedAt") ?? ""),
  });
  if (result.ok) {
    return {
      ok: true,
      intent,
      attemptId: result.attemptId,
      message:
        result.outcome === "sent"
          ? "Marked sent from verified provider evidence. No email was resent."
          : "Marked failed from verified provider evidence. This action did not resend email.",
    };
  }
  const messages = {
    invalid_evidence: "Provider evidence is incomplete or does not match the selected outcome.",
    idempotency_conflict: "This reconciliation key was already used for different evidence. Refresh before retrying.",
    stale: "This attempt changed before reconciliation. Refresh and verify its current provider state.",
    not_found: "This attempt no longer exists. Refresh the operator desk.",
  } as const;
  return {
    ok: false,
    intent,
    attemptId: String(formData.get("attemptId") ?? ""),
    message: messages[result.reason],
  };
}

export default function OpsRoute() {
  const { snapshot, outstandingBillingAttempts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <section className="f9-app-stack">
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-app-kicker">Ops</p>
          <h2>Evidence-first monitoring health</h2>
        </div>
      </div>

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
          </div>
        </article>

        <article className="f9-app-panel">
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
            empty="No billing lifecycle emails are awaiting provider reconciliation."
            items={outstandingBillingAttempts}
            title="Billing email provider reconciliation"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.provider} · {item.templateName ?? "Billing lifecycle"}</p>
                <h3>Email to {item.recipient}</h3>
                <p>
                  Confirm the outcome in provider logs or a controlled inbox. This records evidence and state only; it never resends an email.
                </p>
                <p className="f9-muted-copy">
                  Unknown since <LocalTime iso={item.updatedAt} />
                </p>
                <Form className="f9-app-stack" method="post">
                  <input name="intent" type="hidden" value="reconcile-billing-email" />
                  <input name="attemptId" type="hidden" value={item.attemptId} />
                  <input name="expectedUpdatedAt" type="hidden" value={item.updatedAt} />
                  <input name="reconciliationKey" type="hidden" value={item.reconciliationKey} />
                  <label>
                    Provider-confirmed outcome
                    <select name="outcome" required>
                      <option value="">Choose outcome</option>
                      <option value="sent">Sent or delivered</option>
                      <option value="failed">Not accepted or failed</option>
                    </select>
                  </label>
                  <label>
                    Evidence source
                    <select name="classification" required>
                      <option value="">Choose evidence source</option>
                      <option value="cloudflare_email_log">Cloudflare Email log</option>
                      <option value="controlled_inbox_receipt">Controlled inbox receipt</option>
                      <option value="provider_rejection_log">Provider rejection log</option>
                    </select>
                  </label>
                  <label>
                    Provider evidence reference
                    <input
                      autoComplete="off"
                      maxLength={160}
                      name="evidenceReference"
                      pattern="[A-Za-z0-9][A-Za-z0-9._:-]{5,159}"
                      placeholder="provider_event_12345"
                      required
                    />
                  </label>
                  <label>
                    Provider observed at (UTC ISO 8601)
                    <input
                      autoComplete="off"
                      name="observedAt"
                      placeholder="2026-07-15T18:01:00Z"
                      required
                    />
                  </label>
                  <SubmitButton
                    className="f9-secondary-button"
                    intent="reconcile-billing-email"
                    match={{ attemptId: item.attemptId }}
                    pendingLabel="Recording…"
                  >
                    Record provider evidence
                  </SubmitButton>
                </Form>
                <ActionFeedback
                  data={actionData}
                  intent="reconcile-billing-email"
                  match={{ attemptId: item.attemptId }}
                />
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
                <h3>
                  {item.channel === "email" ? "Email" : "WhatsApp"} to {item.target_value}
                </h3>
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
                <h3>{item.target_value}</h3>
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

async function requireOpsAccess(context: LoaderFunctionArgs["context"], request: Request) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { isOpsUserAllowed } = await import("~/lib/env.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  if (!isOpsUserAllowed(env, session.user.email)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { env, session };
}

function maskOperatorSnapshot<T extends {
  deliveryAttention: Array<{ target_value: string }>;
  blockedTargets: Array<{ target_value: string }>;
}>(snapshot: T): T {
  return {
    ...snapshot,
    deliveryAttention: snapshot.deliveryAttention.map((item) => ({
      ...item,
      target_value: maskDeliveryTarget(item.target_value),
    })),
    blockedTargets: snapshot.blockedTargets.map((item) => ({
      ...item,
      target_value: maskDeliveryTarget(item.target_value),
    })),
  } as T;
}

function maskDeliveryTarget(value: string) {
  const normalized = value.trim();
  const at = normalized.lastIndexOf("@");
  if (at > 0) {
    const local = normalized.slice(0, at);
    const domain = normalized.slice(at + 1);
    const [host, ...suffix] = domain.split(".");
    return `${maskSegment(local)}@${maskSegment(host)}${suffix.length ? `.${suffix.at(-1)}` : ""}`;
  }
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

function maskSegment(value: string) {
  return value ? `${value[0]}•••` : "•••";
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
  error_message: string | null;
}) {
  if (item.status === "pending" && item.webhook_status === "provider_unknown") {
    return "Provider outcome is unknown. Verify it in provider logs before reconciling; do not resend blindly.";
  }

  return "Delivery failed. Use the provider log and structured attempt record for diagnosis.";
}

function describeRunFailure(errorCode: string | null) {
  if (errorCode === "provider_unavailable") {
    return "The discovery provider was unavailable. Retry after provider health recovers.";
  }
  if (errorCode === "capacity_unavailable" || errorCode === "rate_limited") {
    return "The run could not acquire provider capacity. Check the scheduled retry and quota state.";
  }
  return "The run failed. Inspect structured logs using the run identifier; raw provider errors are intentionally hidden here.";
}

function describeProofFailure(failureCode: string | null) {
  if (failureCode === "capture_timeout") return "Evidence capture timed out";
  if (failureCode === "provider_unavailable") return "Evidence provider unavailable";
  if (failureCode === "budget_exhausted") return "Evidence budget exhausted";
  return "Evidence check failed";
}

function describeDiscoveryProviderState(status: string) {
  if (status === "healthy") return "Recent source checks succeeded.";
  if (status === "degraded") {
    return "Source checks are degraded. Review structured discovery logs before promising fresh coverage.";
  }
  return "Fresh source coverage is unavailable. Keep customer-facing status in degraded mode until a live check succeeds.";
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
