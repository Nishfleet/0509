import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Sources | Five to Nine" },
  {
    name: "description",
    content: "Connect customer-owned Meta access for beta Meta ads tracking in Five to Nine.",
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
      message: "Meta token disconnected.",
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
    <section className="workspace-section-stack">
      <section className="source-setup-card">
        <div className="card-header">
          <div>
            <p className="section-label">Source setup</p>
            <h2>Meta ads tracking <span className="badge badge-beta">Beta</span></h2>
          </div>
          <Link className="button button-secondary" to="/app/watchlists">
            Open watchlists
          </Link>
        </div>

        <p className="muted-text">
          Connect the customer's own Meta token so Five to Nine can use the official Ad Library API
          fallback without relying on a shared platform token.
        </p>

        <div className="status-strip">
          <div>
            <span className="section-label">Connection</span>
            <strong>{statusLabel}</strong>
            {data.connection ? (
              <p className="muted-text">
                Token ends in {data.connection.tokenLastFour}
                {data.connection.lastCheckedAt
                  ? ` · tested ${new Date(data.connection.lastCheckedAt).toLocaleString("en-IN")}`
                  : ""}
              </p>
            ) : (
              <p className="muted-text">No customer-owned Meta token is connected yet.</p>
            )}
          </div>
          <div>
            <span className="section-label">Live path</span>
            <strong>{formatDiscoveryStatus(data.discoveryStatus.status)}</strong>
            <p className="muted-text">{data.discoveryStatus.summary}</p>
          </div>
        </div>

        <div className="source-readiness-panel">
          <div>
            <span className="section-label">Beta graduation gate</span>
            <strong>{data.betaReadiness.label}</strong>
            <p className="muted-text">
              {data.betaReadiness.samples}/{data.betaReadiness.sampleTarget} live samples in the last{" "}
              {data.betaReadiness.windowDays} days · {formatSuccessRate(data.betaReadiness.successRate)} success
              {data.betaReadiness.latestSuccessAt
                ? ` · last success ${new Date(data.betaReadiness.latestSuccessAt).toLocaleString("en-IN")}`
                : " · no recent live success yet"}
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
          <div className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
            <p>{actionData.message}</p>
          </div>
        ) : null}

        <div className="workspace-panels">
          <section className="content-card source-guide-card">
            <p className="section-label">Stupid-proof steps</p>
            <h3>How the customer gets the token</h3>
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
            <p className="muted-text">
              The token is stored encrypted. It is only used for this workspace's Meta API fallback.
            </p>
          </section>

          <section className="content-card source-guide-card">
            <p className="section-label">Connect</p>
            <h3>Paste and test</h3>
            <Form className="stack-form" method="post">
              <input name="intent" type="hidden" value="connect-meta-token" />
              <label className="field">
                <span>Meta access token</span>
                <textarea
                  autoComplete="off"
                  name="metaToken"
                  placeholder="Paste the full Meta access token here"
                  rows={5}
                />
              </label>
              <button className="button button-primary" type="submit">
                Test and save token
              </button>
            </Form>

            {data.connection ? (
              <div className="inline-actions source-actions">
                <Form method="post">
                  <input name="intent" type="hidden" value="retest-meta-token" />
                  <button className="button button-secondary" type="submit">
                    Retest saved token
                  </button>
                </Form>
                <Form method="post">
                  <input name="intent" type="hidden" value="disconnect-meta-token" />
                  <button className="button button-secondary" type="submit">
                    Disconnect
                  </button>
                </Form>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <article className="callout-card">
        <p className="section-label">Beta guardrail</p>
        <p>
          Meta ads tracking stays beta until live discovery, proof capture, and daily digest canaries
          stay green. Website snapshots, price/discount checks, and proof-backed reports are not
          blocked by this label.
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
    return "Needs a fresh token";
  }
  return "Untested";
}

function formatDiscoveryStatus(status: string) {
  if (status === "cache_only") {
    return "Cache only";
  }
  if (status === "healthy") {
    return "Live beta";
  }
  return status.replaceAll("_", " ");
}

function formatSuccessRate(value: number | null) {
  if (value === null) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
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
