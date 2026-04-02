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
  const { getEnv } = await import("~/lib/context.server");
  const {
    getMetaIntegrationStatus,
    listCollections,
    listDigests,
    listSavedQueries,
    listWatchlists,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const [savedQueries, collections, watchlists, digests, metaStatus] = await Promise.all([
    listSavedQueries(env, session.user.id),
    listCollections(env, session.user.id),
    listWatchlists(env, session.user.id),
    listDigests(env, session.user.id),
    getMetaIntegrationStatus(env),
  ]);

  return {
    savedQueries,
    collections,
    watchlists,
    digests,
    metaStatus,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
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
      ? "Live and healthy"
      : data.metaStatus.status === "demo"
        ? "Demo mode"
        : "Needs attention";

  return (
    <section className="workspace-section-stack">
      <div className="stats-grid">
        <article className="metric-card">
          <span>Saved queries</span>
          <strong>{data.savedQueries.length}</strong>
        </article>
        <article className="metric-card">
          <span>Collections</span>
          <strong>{data.collections.length}</strong>
        </article>
        <article className="metric-card">
          <span>Watchlists</span>
          <strong>{data.watchlists.length}</strong>
        </article>
        <article className="metric-card">
          <span>Weekly digests</span>
          <strong>{data.digests.length}</strong>
        </article>
      </div>

      <article className="content-card status-card">
        <div>
          <p className="section-label">Meta integration</p>
          <h2>{metaHeading}</h2>
        </div>
        <p>{data.metaStatus.summary}</p>
        {data.metaStatus.lastCheckedAt ? (
          <p className="muted-text">Last checked {new Date(data.metaStatus.lastCheckedAt).toLocaleString("en-IN")}.</p>
        ) : null}
      </article>

      {actionData?.message ? (
        <p className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
          {actionData.message}
        </p>
      ) : null}

      <div className="workspace-panels">
        <article className="content-card">
          <div className="card-header">
            <div>
              <p className="section-label">Saved queries</p>
              <h2>Reusable research inputs</h2>
            </div>
            <Link className="button button-secondary" to="/search">
              Save another search
            </Link>
          </div>

          {data.savedQueries.length === 0 ? (
            <p className="muted-text">
              Save a search from the search flow to start building a repeatable monitoring loop.
            </p>
          ) : (
            <div className="stack-list">
              {data.savedQueries.map((query) => (
                <article className="list-card" key={query.id}>
                  <div>
                    <h3>{query.name}</h3>
                    <p className="muted-text">
                      {query.mode} · {query.queryText || "No query"} · {query.normalizedQuery.filters.country}
                    </p>
                    <p className="muted-text">
                      Ran {query.runCount} times
                      {query.lastRunAt ? ` · last run ${new Date(query.lastRunAt).toLocaleDateString("en-IN")}` : ""}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <Form method="post">
                      <input name="intent" type="hidden" value="run-saved-query" />
                      <input name="savedQueryId" type="hidden" value={query.id} />
                      <button className="button button-secondary" type="submit">
                        Run search
                      </button>
                    </Form>
                    <Form method="post">
                      <input name="intent" type="hidden" value="track-saved-query" />
                      <input name="savedQueryId" type="hidden" value={query.id} />
                      <button className="button button-primary" type="submit">
                        Track changes
                      </button>
                    </Form>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="content-card">
          <div className="card-header">
            <div>
              <p className="section-label">Collections</p>
              <h2>Saved findings</h2>
            </div>
            <Link className="button button-secondary" to="/app/collections">
              Open collections
            </Link>
          </div>
          <div className="stack-list compact-list">
            {data.collections.slice(0, 4).map((collection) => (
              <div className="list-card" key={collection.id}>
                <div>
                  <h3>{collection.name}</h3>
                  <p className="muted-text">{collection.description || "No description yet."}</p>
                </div>
              </div>
            ))}
            {data.collections.length === 0 ? (
              <p className="muted-text">Collections appear here as soon as you start saving ads.</p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
