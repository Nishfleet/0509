import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { ReportView } from "~/components/report-view";
import { isReportDocument } from "~/lib/report";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCollection,
    getDigest,
    getShareLink,
    getWatchlist,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const token = params.token;

  if (!token) {
    throw new Response("Not found", { status: 404 });
  }

  const share = await getShareLink(env, token);
  if (!share) {
    throw new Response("Not found", { status: 404 });
  }

  if (share.isSnapshot) {
    return {
      mode: "snapshot" as const,
      resourceType: share.resourceType,
      payload: share.snapshotPayload,
    };
  }

  if (share.resourceType === "collection") {
    const collection = await getCollection(env, share.resourceId);
    const items = collection ? await listCollectionItems(env, collection.id) : [];

    return {
      mode: "live" as const,
      resourceType: "collection" as const,
      collection,
      items,
    };
  }

  if (share.resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, share.resourceId);
    const events = watchlist ? await listWatchEvents(env, watchlist.id, 60) : [];

    return {
      mode: "live" as const,
      resourceType: "watchlist" as const,
      watchlist,
      events,
    };
  }

  if (share.resourceType === "report") {
    throw new Response("Not found", { status: 404 });
  }

  const digest = await getDigest(env, share.resourceId);

  return {
    mode: "live" as const,
    resourceType: "digest" as const,
    digest,
  };
}

export default function ShareRoute() {
  const data = useLoaderData<typeof loader>();
  const reportSnapshot = "payload" in data && isReportDocument(data.payload) ? data.payload : null;
  const digestSnapshot =
    "payload" in data && data.resourceType === "digest" && isDigestSnapshotPayload(data.payload)
      ? data.payload
      : null;

  return (
    <main className="share-shell">
      <div className="container">
        <div className="share-header">
          <Link className="brand-mark" to="/">
            <span className="brand-pill" aria-hidden="true">
              09
            </span>
            <span>
              <strong>Five to Nine</strong>
              <small>Shared view</small>
            </span>
          </Link>
        </div>

        {reportSnapshot ? (
          <article className="content-card report-page-card">
            <div className="card-header report-toolbar">
              <div>
                <p className="section-label">Shared report snapshot</p>
                <h2>{reportSnapshot.title}</h2>
              </div>
              <button
                className="button button-secondary"
                onClick={() => window.print()}
                type="button"
              >
                Download PDF
              </button>
            </div>
            <ReportView report={reportSnapshot} />
          </article>
        ) : digestSnapshot ? (
          <article className="content-card">
            <p className="section-label">Shared digest snapshot</p>
            <h1>
              {new Date(digestSnapshot.periodStart).toLocaleDateString("en-IN")} to{" "}
              {new Date(digestSnapshot.periodEnd).toLocaleDateString("en-IN")}
            </h1>
            <ul className="event-list">
              {digestSnapshot.items.map((item) => (
                <li className="event-card" key={item.id}>
                  <div className="card-header">
                    <div>
                      <p className="section-label">{item.watchlistName}</p>
                      <h3>{item.title}</h3>
                    </div>
                    <span className="badge">{item.eventType.replaceAll("_", " ")}</span>
                  </div>
                  <p>{item.summary}</p>
                </li>
              ))}
            </ul>
          </article>
        ) : "payload" in data ? (
          <article className="content-card">
            <p className="section-label">Snapshot share</p>
            <pre className="snapshot-pre">{JSON.stringify(data.payload, null, 2)}</pre>
          </article>
        ) : data.resourceType === "collection" ? (
          <article className="content-card">
            <p className="section-label">Shared collection</p>
            <h1>{data.collection?.name ?? "Collection unavailable"}</h1>
            <div className="stack-list">
              {data.items.map((item) => (
                <div className="list-card" key={item.id}>
                  <h3>{item.ad.advertiser}</h3>
                  <p>{item.ad.hook}</p>
                  <p className="muted-text">{item.tags.join(", ") || "No tags"}</p>
                </div>
              ))}
            </div>
          </article>
        ) : data.resourceType === "watchlist" ? (
          <article className="content-card">
            <p className="section-label">Shared watchlist</p>
            <h1>{data.watchlist?.name ?? "Watchlist unavailable"}</h1>
            <ul className="event-list">
              {data.events.map((event) => (
                <li className="event-card" key={event.id}>
                  <h3>{event.title}</h3>
                  <p>{event.summary}</p>
                </li>
              ))}
            </ul>
          </article>
        ) : (
          <article className="content-card">
            <p className="section-label">Shared digest</p>
            <h1>Weekly digest</h1>
            <ul className="event-list">
              {data.digest?.items.map((item) => (
                <li className="event-card" key={item.id}>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </main>
  );
}

function isDigestSnapshotPayload(value: unknown): value is {
  periodStart: string;
  periodEnd: string;
  items: Array<{
    id: string;
    watchlistName: string;
    eventType: string;
    title: string;
    summary: string;
  }>;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.periodStart === "string" &&
    typeof candidate.periodEnd === "string" &&
    Array.isArray(candidate.items)
  );
}
