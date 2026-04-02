import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { createReportId } from "~/lib/report";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWatchlist, listWatchEvents, listWatchlistRuns, listWatchlists } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const watchlists = await listWatchlists(env, session.user.id);
  const url = new URL(request.url);
  const selectedWatchlistId = url.searchParams.get("watchlist") ?? watchlists[0]?.id ?? null;
  const selectedWatchlist = selectedWatchlistId
    ? await getWatchlist(env, selectedWatchlistId, session.user.id)
    : null;
  const events = selectedWatchlist ? await listWatchEvents(env, selectedWatchlist.id, 60) : [];
  const runs = selectedWatchlist ? await listWatchlistRuns(env, selectedWatchlist.id, 12) : [];

  return {
    watchlists,
    selectedWatchlist,
    events,
    runs,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createShareLink, getWatchlist } = await import("~/lib/data.server");
  const { runWatchlistManual } = await import("~/lib/monitoring.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "refresh-watchlist") {
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, session.user.id);

    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }

    await runWatchlistManual(env, watchlist);
    return {
      ok: true,
      message: `${watchlist.name} refreshed successfully.`,
    };
  }

  if (intent === "share-watchlist") {
    const watchlistId = String(formData.get("watchlistId") ?? "");
    const watchlist = await getWatchlist(env, watchlistId, session.user.id);
    if (!watchlist) {
      return { ok: false, message: "Watchlist not found." };
    }
    const share = await createShareLink(env, session, {
      resourceType: "watchlist",
      resourceId: watchlist.id,
      isSnapshot: false,
    });

    return {
      ok: true,
      message: `${new URL(`/share/${share.token}`, request.url).toString()}`,
    };
  }

  return {
    ok: false,
    message: "Unknown watchlist action.",
  };
}

export default function WatchlistsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  return (
    <section className="workspace-section-stack">
      {actionData?.message ? (
        <p className={`form-message ${actionData.ok ? "form-message-success" : "form-message-error"}`}>
          {actionData.ok && actionData.message.startsWith("http") ? (
            <a href={actionData.message} rel="noreferrer" target="_blank">
              {actionData.message}
            </a>
          ) : (
            actionData.message
          )}
        </p>
      ) : null}

      <div className="workspace-panels">
        <article className="content-card narrow-card">
          <div className="card-header">
            <div>
              <p className="section-label">Watchlists</p>
              <h2>Monitoring loop</h2>
            </div>
          </div>
          <p className="muted-text">
            Create watchlists from the search page or from saved queries on the dashboard.
          </p>

          <div className="stack-list compact-list">
            {data.watchlists.map((watchlist) => (
              <a
                className={`list-card ${searchParams.get("watchlist") === watchlist.id || (!searchParams.get("watchlist") && data.selectedWatchlist?.id === watchlist.id) ? "is-active" : ""}`}
                href={`/app/watchlists?watchlist=${watchlist.id}`}
                key={watchlist.id}
              >
                <div>
                  <h3>{watchlist.name}</h3>
                  <p className="muted-text">
                    {watchlist.targetType.replace("_", " ")} · {watchlist.targetLabel}
                  </p>
                  <p className="muted-text">
                    {watchlist.lastScannedAt
                      ? `Last scanned ${new Date(watchlist.lastScannedAt).toLocaleString("en-IN")}`
                      : "Never scanned yet"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </article>

        <article className="content-card">
          {data.selectedWatchlist ? (
            <>
              <div className="card-header">
                <div>
                  <p className="section-label">Selected watchlist</p>
                  <h2>{data.selectedWatchlist.name}</h2>
                </div>
                <div className="inline-actions">
                  <Link
                    className="button button-secondary"
                    to={`/app/reports/${createReportId("watchlist", data.selectedWatchlist.id)}`}
                  >
                    Open report
                  </Link>
                  <a
                    className="button button-secondary"
                    href={`/export/watchlist/${data.selectedWatchlist.id}`}
                  >
                    Export CSV
                  </a>
                  <Form method="post">
                    <input name="intent" type="hidden" value="share-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <button className="button button-secondary" type="submit">
                      Share summary
                    </button>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="refresh-watchlist" />
                    <input name="watchlistId" type="hidden" value={data.selectedWatchlist.id} />
                    <button className="button button-primary" type="submit">
                      Refresh now
                    </button>
                  </Form>
                </div>
              </div>

              <div className="stack-list">
                <section>
                  <p className="section-label">Recent runs</p>
                  {data.runs.length === 0 ? (
                    <p className="muted-text">No runs recorded yet.</p>
                  ) : (
                    <ul className="event-list">
                      {data.runs.map((run) => (
                        <li className="event-card" key={run.id}>
                          <div className="card-header">
                            <div>
                              <p className="section-label">
                                {run.status} · {run.triggerType}
                              </p>
                              <h3>
                                Started {new Date(run.startedAt).toLocaleString("en-IN")}
                              </h3>
                            </div>
                            <span className="badge">{run.pagesScanned} pages</span>
                          </div>
                          <p className="muted-text">
                            {run.finishedAt
                              ? `Finished ${new Date(run.finishedAt).toLocaleString("en-IN")}`
                              : "Still running"}
                            {run.baselineFromRunId ? ` · baseline ${run.baselineFromRunId.slice(0, 8)}` : ""}
                          </p>
                          {formatRunSummary(run.summary) ? (
                            <p className="muted-text">{formatRunSummary(run.summary)}</p>
                          ) : null}
                          {formatRunEventTypes(run.summary) ? (
                            <p className="muted-text">{formatRunEventTypes(run.summary)}</p>
                          ) : null}
                          {run.errorMessage ? <p>{run.errorMessage}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <p className="section-label">Recent events</p>
                  {data.events.length === 0 ? (
                    <p className="muted-text">
                      No events yet. Run the watchlist or wait for the next scheduled scan.
                    </p>
                  ) : (
                    <ul className="event-list">
                      {data.events.map((event) => (
                        <li className="event-card" key={event.id}>
                          <div className="card-header">
                            <div>
                              <p className="section-label">{event.eventType.replaceAll("_", " ")}</p>
                              <h3>{event.title}</h3>
                            </div>
                            <span className="muted-text">
                              {new Date(event.createdAt).toLocaleString("en-IN")}
                            </span>
                          </div>
                          <p>{event.summary}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>No watchlist selected</h2>
              <p>Track a search from the dashboard or the search page to see monitoring history here.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function formatRunSummary(summary: Record<string, unknown>) {
  const parts = [
    formatNumericSummaryPart(summary, "adsSeen", "ads seen"),
    formatNumericSummaryPart(summary, "events", "events"),
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

function formatRunEventTypes(summary: Record<string, unknown>) {
  const value = summary.eventTypes;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const parts = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([eventType, count]) => `${count} ${eventType.replaceAll("_", " ")}`);

  return parts.join(" · ");
}

function formatNumericSummaryPart(
  summary: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = summary[key];
  return typeof value === "number" ? `${value} ${label}` : null;
}
