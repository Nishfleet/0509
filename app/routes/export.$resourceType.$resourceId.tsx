import type { LoaderFunctionArgs } from "react-router";

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const {
    getCollection,
    getDigest,
    getWatchlist,
    listCollectionItems,
    listWatchEvents,
  } = await import("~/lib/data.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const resourceType = params.resourceType;
  const resourceId = params.resourceId;

  if (!resourceType || !resourceId) {
    throw new Response("Not found", { status: 404 });
  }

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, session.user.id);
    if (!collection) {
      throw new Response("Not found", { status: 404 });
    }

    const items = await listCollectionItems(env, collection.id);
    return csvResponse(
      "collection.csv",
      [
        ["advertiser", "hook", "offer", "cta", "tags", "note"],
        ...items.map((item) => [
          item.ad.advertiser,
          item.ad.hook,
          item.ad.offer,
          item.ad.cta,
          item.tags.join("|"),
          item.note ?? "",
        ]),
      ],
    );
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, session.user.id);
    if (!watchlist) {
      throw new Response("Not found", { status: 404 });
    }

    const events = await listWatchEvents(env, watchlist.id, 200);
    return csvResponse(
      "watchlist.csv",
      [
        ["event_type", "title", "summary", "created_at"],
        ...events.map((event) => [
          event.eventType,
          event.title,
          event.summary,
          event.createdAt,
        ]),
      ],
    );
  }

  if (resourceType === "digest") {
    const digest = await getDigest(env, resourceId);
    if (!digest || digest.userId !== session.user.id) {
      throw new Response("Not found", { status: 404 });
    }

    return csvResponse(
      "digest.csv",
      [
        ["watchlist", "event_type", "title", "summary"],
        ...digest.items.map((item) => [
          item.watchlistName,
          item.eventType,
          item.title,
          item.summary,
        ]),
      ],
    );
  }

  throw new Response("Not found", { status: 404 });
}

function csvResponse(filename: string, rows: string[][]) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");

  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
