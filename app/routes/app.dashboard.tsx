import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { buildSearchParams } from "~/lib/normalize";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { resolveCommercialAdSourceStatus } = await import("~/lib/ad-source.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCustomerMetaConnection,
    listCollections,
    listDigests,
    listSavedQueries,
    listWatchlists,
  } = await import("~/lib/data.server");
  const { getProofUsageSummary } = await import("~/lib/plan.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const [savedQueries, collections, watchlists, digests, metaStatus, customerMetaConnection, proofUsage] = await Promise.all([
    listSavedQueries(env, session.user.id),
    listCollections(env, session.user.id),
    listWatchlists(env, session.user.id),
    listDigests(env, session.user.id),
    resolveCommercialAdSourceStatus(env),
    getCustomerMetaConnection(env, session.user.id),
    getProofUsageSummary(env, session.user.id),
  ]);

  return {
    savedQueries,
    collections,
    watchlists,
    digests,
    metaStatus,
    proofUsage,
    customerMetaConnection: customerMetaConnection
      ? {
          status: customerMetaConnection.status,
          tokenLastFour: customerMetaConnection.tokenLastFour,
          lastCheckedAt: customerMetaConnection.lastCheckedAt,
        }
      : null,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { checkPlanLimit } = await import("~/lib/plan.server");
  const { createWatchlist, getSavedQuery, touchSavedQueryRun } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "run-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, session.user.id);

    if (!savedQuery) {
      return {
        ok: false,
        message: "Saved query not found.",
      };
    }

    await touchSavedQueryRun(env, savedQuery.id);
    throw redirect(`/search?${buildSearchParams(savedQuery.normalizedQuery).toString()}`);
  }

  if (intent === "track-saved-query") {
    const savedQueryId = String(formData.get("savedQueryId") ?? "");
    const savedQuery = await getSavedQuery(env, savedQueryId, session.user.id);

    if (!savedQuery) {
      return {
        ok: false,
        message: "Saved query not found.",
      };
    }

    const watchlistLimit = await checkPlanLimit(env, session.user.id, "watchlists");
    if (!watchlistLimit.allowed) {
      return {
        ok: false,
        error: "plan_limit_exceeded",
        limit: watchlistLimit.limit,
        current: watchlistLimit.current,
        message: "You have reached your workspace watchlist limit.",
      };
    }

    await createWatchlist(env, session.user.id, {
      name: `${savedQuery.name} watch`,
      targetType: "saved_query",
      targetId: savedQuery.id,
      targetFingerprint: savedQuery.fingerprint,
      targetLabel: savedQuery.name,
    });

    return {
      ok: true,
      message: `Now tracking ${savedQuery.name}.`,
    };
  }

  return {
    ok: false,
    message: "Unknown dashboard action.",
  };
}

export default function AppDashboardRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const metaHeading =
    data.metaStatus.status === "healthy"
      ? "Commercial discovery live"
      : data.metaStatus.status === "cache_only"
        ? "Cache only"
      : data.metaStatus.status === "demo"
        ? "Demo mode"
        : data.metaStatus.status === "disabled"
          ? "Disabled"
        : "Needs attention";

  return (
    <section className="f9-app-stack">
      <div className="f9-metrics-grid">
        <article className="f9-metric-tile">
          <span>Monitoring inputs</span>
          <strong>{data.savedQueries.length}</strong>
        </article>
        <article className="f9-metric-tile">
          <span>Saved proof</span>
          <strong>{data.collections.length}</strong>
        </article>
        <article className="f9-metric-tile">
          <span>Watchlists</span>
          <strong>{data.watchlists.length}</strong>
        </article>
        <article className="f9-metric-tile">
          <span>Digest history</span>
          <strong>{data.digests.length}</strong>
        </article>
      </div>

      <article className="f9-app-panel f9-status-panel">
        <div>
          <span className="f9-app-kicker">Source health</span>
          <h2>{metaHeading}</h2>
        </div>
        <span className={`f9-status-pill is-${data.metaStatus.status}`}>{data.metaStatus.status.replaceAll("_", " ")}</span>
        <p>{data.metaStatus.summary}</p>
        {data.customerMetaConnection ? (
          <p className="f9-muted-copy">
            Customer Meta token connected. Ends in {data.customerMetaConnection.tokenLastFour}.
          </p>
        ) : (
          <p className="f9-muted-copy">
            Connect a customer-owned source token before relying on fallback data.
          </p>
        )}
        {data.metaStatus.lastCheckedAt ? (
          <p className="f9-muted-copy">Last checked {new Date(data.metaStatus.lastCheckedAt).toLocaleString("en-IN")}.</p>
        ) : null}
        <Link className="f9-secondary-button" to="/app/sources">
          Review source setup
        </Link>
      </article>

      {data.proofUsage.warningLevel !== "ok" ? (
        <article className={`f9-app-panel f9-proof-usage-alert is-${data.proofUsage.warningLevel}`}>
          <div>
            <span className="f9-app-kicker">Proof usage</span>
            <h2>
              {data.proofUsage.warningLevel === "exhausted"
                ? "Proof capture limit reached."
                : "Proof capture usage is above 80%."}
            </h2>
          </div>
          <p>
            {data.proofUsage.used} of {data.proofUsage.limit} proof captures used in the last 30 days.
            {data.proofUsage.upgradeTarget
              ? ` Move to ${data.proofUsage.upgradeTarget} or add an overflow pack before the next noisy launch.`
              : " Add an overflow pack before the next noisy launch."}
          </p>
          <Link className="f9-secondary-button" to="/#pricing">
            Review capacity
          </Link>
        </article>
      ) : null}

      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <div className="f9-dashboard-grid">
        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Saved queries</span>
              <h2>Turn searches into monitoring inputs</h2>
            </div>
            <Link className="f9-secondary-button" to="/search">
              Save another search
            </Link>
          </div>

          {data.savedQueries.length === 0 ? (
            <p className="f9-muted-copy">
              Save a search from the search flow, then turn it into a watchlist that tells you what changed next.
            </p>
          ) : (
            <div className="f9-work-list">
              {data.savedQueries.map((query) => (
                <article className="f9-work-row" key={query.id}>
                  <div>
                    <h3>{query.name}</h3>
                    <p className="f9-muted-copy">
                      {query.mode} · {query.queryText || "No query"} · {query.normalizedQuery.filters.country}
                    </p>
                    <p className="f9-muted-copy">
                      Ran {query.runCount} times
                      {query.lastRunAt ? ` · last run ${new Date(query.lastRunAt).toLocaleDateString("en-IN")}` : ""}
                    </p>
                  </div>
                  <div className="f9-action-row">
                    <Form method="post">
                      <input name="intent" type="hidden" value="run-saved-query" />
                      <input name="savedQueryId" type="hidden" value={query.id} />
                      <button className="f9-secondary-button" type="submit">
                        Run search
                      </button>
                    </Form>
                    <Form method="post">
                      <input name="intent" type="hidden" value="track-saved-query" />
                      <input name="savedQueryId" type="hidden" value={query.id} />
                      <button className="f9-primary-button" type="submit">
                        Watch for changes
                      </button>
                    </Form>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Collections</span>
              <h2>Keep the proof that matters</h2>
            </div>
            <Link className="f9-secondary-button" to="/app/collections">
              Open collections
            </Link>
          </div>
          <div className="f9-work-list is-compact">
            {data.collections.slice(0, 4).map((collection) => (
              <div className="f9-work-row" key={collection.id}>
                <div>
                  <h3>{collection.name}</h3>
                  <p className="f9-muted-copy">{collection.description || "No description yet."}</p>
                </div>
              </div>
            ))}
            {data.collections.length === 0 ? (
              <p className="f9-muted-copy">Collections appear here as soon as you start saving proof, ads, and notes.</p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
