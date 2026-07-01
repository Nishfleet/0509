import type { ReactNode } from "react";
import { useLoaderData } from "react-router";
import { LocalTime } from "~/components/local-time";
import type { LoaderFunctionArgs } from "react-router";

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

  const { getOperatorSnapshot } = await import("~/lib/data.server");
  const snapshot = await getOperatorSnapshot(env);

  return {
    snapshot,
  };
}

export default function OpsRoute() {
  const { snapshot } = useLoaderData<typeof loader>();

  return (
    <section className="f9-app-stack">
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-app-kicker">Ops</p>
          <h2>Proof-first monitoring health</h2>
        </div>
      </div>

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel f9-side-panel">
          <div className="f9-work-list is-compact">
            <MetricCard label="Failing runs" value={snapshot.summary.failingRuns} />
            <MetricCard label="Stuck runs" value={snapshot.summary.stuckRuns} />
            <MetricCard label="Failed proofs" value={snapshot.summary.failedProofs} />
            <MetricCard label="Budget-blocked proofs" value={snapshot.summary.budgetBlockedProofs} />
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
                <p>{item.error_message ?? item.error_code ?? "Unknown run failure."}</p>
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
            empty="No failed proofs in the recent window."
            items={snapshot.failedProofs}
            title="Recent proof failures"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{item.failure_reason ?? item.failure_code ?? "Proof capture failed"}</h3>
                <p className="f9-muted-copy">{formatTimestamp(item.attempted_at)}</p>
              </>
            )}
          />

          <OpsSection
            empty="No proofs are currently paused by budget or rate limits."
            items={snapshot.budgetBlockedProofs}
            title="What is paused by budget"
            renderItem={(item) => (
              <>
                <p className="f9-app-kicker">{item.watchlist_name}</p>
                <h3>{item.status === "skipped_due_to_rate_limit" ? "Rate-limited proof" : "Budget-skipped proof"}</h3>
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
                <p>{item.summary}</p>
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
                  {item.failed_runs} failed runs · {item.failed_proofs} failed proofs · {item.failed_deliveries} failed deliveries
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
  error_message: string | null;
}) {
  if (item.status === "pending" && item.webhook_status === "provider_unknown") {
    return item.error_message ?? "Provider outcome is unknown; check Cloudflare Email Sending logs.";
  }

  return item.error_message ?? "Delivery failed for an operational reason.";
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
