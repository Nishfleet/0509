import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Tracking access | Five to Nine" },
  {
    name: "description",
    content: "Review the access that keeps competitor tracking reliable in Five to Nine.",
  },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getCustomerMetaConnection } = await import("~/lib/data.server");
  const { getMetaAdsBetaReadiness } = await import("~/lib/meta-ads-readiness.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const [connection, discoveryStatus, betaReadiness] = await Promise.all([
    getCustomerMetaConnection(env, session.user.id),
    resolveCommercialAdSourceStatus(env),
    getMetaAdsBetaReadiness(env),
  ]);

  return {
    connection: connection
      ? {
          status: connection.status,
          tokenLastFour: connection.tokenLastFour,
          summary: connection.summary,
          lastCheckedAt: connection.lastCheckedAt,
          lastErrorCode: connection.lastErrorCode,
          lastErrorMessage: connection.lastErrorMessage,
          updatedAt: connection.updatedAt,
        }
      : null,
    discoveryStatus,
    betaReadiness,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    disconnectCustomerMetaToken,
    retestSavedCustomerMetaToken,
    saveCustomerMetaToken,
  } = await import("~/lib/customer-meta.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "connect-meta-token") {
    const token = String(formData.get("metaToken") ?? "");
    const result = await saveCustomerMetaToken(env, session.user.id, token);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "retest-meta-token") {
    const result = await retestSavedCustomerMetaToken(env, session.user.id);

    return {
      ok: result.ok,
      message: result.testResult.summary,
    };
  }

  if (intent === "disconnect-meta-token") {
    await disconnectCustomerMetaToken(env, session.user.id);
    return {
      ok: true,
      message: "Backup Meta access disconnected.",
    };
  }

  return {
    ok: false,
    message: "Unknown source action.",
  };
}

export default function AppSourcesRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const statusLabel = data.connection ? formatConnectionStatus(data.connection.status) : "Not connected";

  return (
    <section className="f9-app-stack">
      <section className="f9-app-panel f9-source-setup">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Tracking reliability</span>
            <h2>Keep competitor tracking reliable</h2>
          </div>
          <Link className="f9-secondary-button" to="/app/watchlists">
            Open watchlists
          </Link>
        </div>

        <p className="f9-muted-copy">
          Five to Nine checks public ad and landing-page signals for you. If Meta limits access, add your own Meta Ad
          Library token so this account has a backup.
        </p>

        <div className="f9-status-strip">
          <div>
            <span className="f9-app-kicker">Backup access</span>
            <strong>{statusLabel}</strong>
            {data.connection ? (
              <p className="f9-muted-copy">
                Connected token ends in {data.connection.tokenLastFour}
                {data.connection.lastCheckedAt
                  ? ` · tested ${new Date(data.connection.lastCheckedAt).toLocaleString("en-IN")}`
                  : ""}
              </p>
            ) : (
              <p className="f9-muted-copy">No backup Meta access is connected yet.</p>
            )}
          </div>
          <div>
            <span className="f9-app-kicker">Tracking status</span>
            <strong>{formatDiscoveryStatus(data.discoveryStatus.status)}</strong>
            <p className="f9-muted-copy">{formatTrackingStatusSummary(data.discoveryStatus.summary)}</p>
          </div>
        </div>

        <div className="f9-source-readiness-panel">
          <div>
            <span className="f9-app-kicker">Recent tracking health</span>
            <strong>{formatReadinessLabel(data.betaReadiness.label)}</strong>
            <p className="f9-muted-copy">
              {data.betaReadiness.samples}/{data.betaReadiness.sampleTarget} fresh checks in the last{" "}
              {data.betaReadiness.windowDays} days · {formatSuccessRate(data.betaReadiness.successRate)} successful
              {data.betaReadiness.latestSuccessAt
                ? ` · last success ${new Date(data.betaReadiness.latestSuccessAt).toLocaleString("en-IN")}`
                : " · no recent success yet"}
            </p>
          </div>
          {data.betaReadiness.blockers.length > 0 ? (
            <ul className="source-proof-list">
              {data.betaReadiness.blockers.map((blocker) => (
                <li key={blocker}>{formatReadinessBlocker(blocker)}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {actionData?.message ? (
          <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
            <p>{actionData.message}</p>
          </div>
        ) : null}

        <div className="f9-dashboard-grid">
          <section className="f9-app-panel f9-source-guide">
            <span className="f9-app-kicker">Add backup Meta access</span>
            <h3>Where to get the token</h3>
            <ol className="numbered-guide">
              <li>
                Open Meta's{" "}
                <a href="https://www.facebook.com/ads/library/api/" rel="noreferrer" target="_blank">
                  Ad Library API page
                </a>
                .
              </li>
              <li>Confirm identity and location if Meta asks.</li>
              <li>Create or select a Meta for Developers app.</li>
              <li>
                Open{" "}
                <a href="https://developers.facebook.com/tools/explorer/" rel="noreferrer" target="_blank">
                  Graph API Explorer
                </a>{" "}
                and generate an access token for that app.
              </li>
              <li>Paste the full token below and test it before saving.</li>
            </ol>
            <p className="f9-muted-copy">
              The token is stored encrypted and only used to check ads for this account.
            </p>
          </section>

          <section className="f9-app-panel f9-source-guide">
            <span className="f9-app-kicker">Save backup access</span>
            <h3>Paste and test</h3>
            <Form className="f9-auth-form" method="post">
              <input name="intent" type="hidden" value="connect-meta-token" />
              <label className="f9-field">
                <span>Meta access token</span>
                <textarea
                  autoComplete="off"
                  name="metaToken"
                  placeholder="Paste the full Meta access token here"
                  rows={5}
                />
              </label>
              <button className="f9-primary-button" type="submit">
                Test and save access
              </button>
            </Form>

            {data.connection ? (
              <div className="f9-action-row source-actions">
                <Form method="post">
                  <input name="intent" type="hidden" value="retest-meta-token" />
                  <button className="f9-secondary-button" type="submit">
                    Retest saved access
                  </button>
                </Form>
                <Form method="post">
                  <input name="intent" type="hidden" value="disconnect-meta-token" />
                  <button className="f9-secondary-button" type="submit">
                    Disconnect
                  </button>
                </Form>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <article className="f9-app-panel f9-callout-panel">
        <span className="f9-app-kicker">Reliability guardrail</span>
        <p>
          If fresh ad checks are delayed, website snapshots, visible offer text checks, and reports can
          still continue independently.
        </p>
      </article>
    </section>
  );
}

function formatConnectionStatus(status: string) {
  if (status === "healthy") {
    return "Connected";
  }
  if (status === "degraded") {
    return "Needs fresh access";
  }
  return "Untested";
}

function formatDiscoveryStatus(status: string) {
  if (status === "cache_only") {
    return "Using recent results";
  }
  if (status === "healthy") {
    return "Live tracking ready";
  }
  if (status === "demo") {
    return "Setup needed";
  }
  if (status === "degraded") {
    return "Needs attention";
  }
  if (status === "disabled") {
    return "Unavailable";
  }
  return "Needs attention";
}

function formatSuccessRate(value: number | null) {
  if (value === null) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function formatReadinessLabel(label: string) {
  return label.replace(/^Beta:\s*/i, "");
}

function formatTrackingStatusSummary(summary: string | null | undefined) {
  if (!summary) {
    return "Tracking status will appear after the first check.";
  }

  return summary
    .replace(/Live commercial discovery/gi, "Fresh ad checks")
    .replace(/commercial discovery/gi, "competitor ad checks")
    .replace(/Commercial discovery/gi, "Competitor ad checks")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/Official Meta API/gi, "alternate Meta ad access")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/workspace Meta access/gi, "alternate Meta ad access")
    .replace(/fresh discovery/gi, "fresh checks")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(/demo mode/gi, "sample mode");
}

function formatReadinessBlocker(blocker: string) {
  const labels: Record<string, string> = {
    missing_db: "Production database signals are unavailable.",
    no_recent_live_success: "No fresh live success in the last 24 hours.",
    not_enough_live_samples: "Not enough live samples yet.",
    recent_live_failures: "There were live failures in the last 24 hours.",
    success_rate_below_95_percent: "Seven-day success rate is below 95%.",
    visual_path_not_healthy: "The visual capture path is not consistently healthy yet.",
  };

  return labels[blocker] ?? blocker.replaceAll("_", " ");
}
