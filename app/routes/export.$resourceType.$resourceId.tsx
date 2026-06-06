import type { LoaderFunctionArgs } from "react-router";

import {
  buildChangeIntelligenceSummary,
  readDigestIntelligence,
} from "~/lib/change-intelligence";
import {
  buildCollectionInsightDepth,
  buildDigestInsightDepth,
  buildWatchlistInsightDepth,
  formatInsightDepthMarkdown,
} from "~/lib/insight-depth";
import type {
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

type ExportFormat = "csv" | "json" | "slack";

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
  const format = exportFormatForRequest(request);

  if (!resourceType || !resourceId) {
    throw new Response("Not found", { status: 404 });
  }

  if (resourceType === "collection") {
    const collection = await getCollection(env, resourceId, session.user.id);
    if (!collection) {
      throw new Response("Not found", { status: 404 });
    }

    const items = await listCollectionItems(env, collection.id);
    return collectionExportResponse(collection, items, format);
  }

  if (resourceType === "watchlist") {
    const watchlist = await getWatchlist(env, resourceId, session.user.id);
    if (!watchlist) {
      throw new Response("Not found", { status: 404 });
    }

    const events = await listWatchEvents(env, watchlist.id, 200);
    return watchlistExportResponse(watchlist, events, format);
  }

  if (resourceType === "digest") {
    const digest = await getDigest(env, resourceId);
    if (!digest || digest.userId !== session.user.id) {
      throw new Response("Not found", { status: 404 });
    }

    return digestExportResponse(digest, format);
  }

  throw new Response("Not found", { status: 404 });
}

function exportFormatForRequest(request: Request): ExportFormat {
  const url = new URL(request.url);
  const format = url.searchParams.get("format")?.toLowerCase();
  if (format === "json" || format === "slack") {
    return format;
  }
  return "csv";
}

function collectionExportResponse(
  collection: CollectionRecord,
  items: CollectionItemRecord[],
  format: ExportFormat,
) {
  if (format === "json") {
    const insightDepth = buildCollectionInsightDepth(items);
    return jsonResponse("collection.json", {
      resourceType: "collection",
      generatedAt: new Date().toISOString(),
      collection,
      insightDepth,
      items: items.map((item) => ({
        id: item.id,
        advertiser: stringValue(item.ad.advertiser),
        hook: stringValue(item.ad.hook),
        offer: stringValue(item.ad.offer),
        cta: stringValue(item.ad.cta),
        landingPageUrl: item.ad.landingPageUrl,
        adSnapshotUrl: item.ad.adSnapshotUrl,
        tags: item.tags,
        note: item.note,
        savedAt: item.createdAt,
      })),
    });
  }

  if (format === "slack") {
    const insightDepth = buildCollectionInsightDepth(items);
    return slackResponse(
      "collection.slack.md",
      [
        `*Five to Nine collection: ${collection.name}*`,
        collection.description ? collection.description : null,
        formatInsightDepthMarkdown(insightDepth),
        items.length === 0 ? "No saved proof yet." : "Saved proof:",
        ...items.map(
          (item) =>
            `- ${stringValue(item.ad.advertiser)}: ${stringValue(item.ad.hook)} | ${stringValue(
              item.ad.offer,
            )} | CTA: ${stringValue(item.ad.cta)}${item.note ? ` | Note: ${item.note}` : ""}`,
        ),
      ],
    );
  }

  return csvResponse(
    "collection.csv",
    [
      ["advertiser", "hook", "offer", "cta", "tags", "note"],
      ...items.map((item) => [
        stringValue(item.ad.advertiser),
        stringValue(item.ad.hook),
        stringValue(item.ad.offer),
        stringValue(item.ad.cta),
        item.tags.join("|"),
        item.note ?? "",
      ]),
    ],
  );
}

function watchlistExportResponse(
  watchlist: WatchlistRecord,
  events: WatchEventRecord[],
  format: ExportFormat,
) {
  const enrichedEvents = events.map((event) => ({
    ...event,
    intelligence: buildChangeIntelligenceSummary(event),
  }));
  const insightDepth = buildWatchlistInsightDepth(events);

  if (format === "json") {
    return jsonResponse("watchlist.json", {
      resourceType: "watchlist",
      generatedAt: new Date().toISOString(),
      watchlist,
      insightDepth,
      events: enrichedEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        status: event.status,
        title: event.title,
        summary: event.summary,
        importanceScore: event.importanceScore,
        confirmedAt: event.confirmedAt,
        createdAt: event.createdAt,
        metadata: event.metadata,
        intelligence: event.intelligence,
      })),
    });
  }

  if (format === "slack") {
    return slackResponse(
      "watchlist.slack.md",
      [
        `*Five to Nine watchlist: ${watchlist.name}*`,
        `Target: ${watchlist.targetLabel}`,
        formatInsightDepthMarkdown(insightDepth),
        enrichedEvents.length === 0 ? "No recent changes yet." : "Latest changes:",
        ...enrichedEvents.map(
          (event) =>
            `- ${event.title}: ${event.summary}\n  Priority: ${priorityLabel(
              event.intelligence.priorityBand,
              event.intelligence.priorityScore,
            )}\n  Next move: ${event.intelligence.recommendedAction}\n  Evidence: ${event.intelligence.proofTrail}`,
        ),
      ],
    );
  }

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

function digestExportResponse(digest: DigestRecord, format: ExportFormat) {
  const enrichedItems = digest.items.map((item) => ({
    ...item,
    intelligence: readDigestIntelligence(item.metadata),
  }));
  const insightDepth = buildDigestInsightDepth(digest.items);

  if (format === "json") {
    return jsonResponse("digest.json", {
      resourceType: "digest",
      generatedAt: new Date().toISOString(),
      digest: {
        id: digest.id,
        periodStart: digest.periodStart,
        periodEnd: digest.periodEnd,
        createdAt: digest.createdAt,
        delivery: digest.delivery,
      },
      insightDepth,
      items: enrichedItems.map((item) => ({
        id: item.id,
        watchlistName: item.watchlistName,
        eventType: item.eventType,
        title: item.title,
        summary: item.summary,
        createdAt: item.createdAt,
        metadata: item.metadata,
        intelligence: item.intelligence,
      })),
    });
  }

  if (format === "slack") {
    return slackResponse(
      "digest.slack.md",
      [
        `*Five to Nine digest: ${dateLabel(digest.periodStart)} to ${dateLabel(digest.periodEnd)}*`,
        formatInsightDepthMarkdown(insightDepth),
        enrichedItems.length === 0 ? "No digest changes yet." : "Competitor changes:",
        ...enrichedItems.map(
          (item) =>
            `- ${item.watchlistName}: ${item.title}\n  Summary: ${item.summary}\n  Priority: ${priorityLabel(
              item.intelligence.priorityBand,
              item.intelligence.priorityScore,
            )}\n  Next move: ${item.intelligence.recommendedAction}\n  Evidence: ${item.intelligence.proofTrail}`,
        ),
      ],
    );
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
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function jsonResponse(filename: string, payload: Record<string, unknown>) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

function slackResponse(filename: string, lines: Array<string | null>) {
  return new Response(lines.filter(Boolean).join("\n\n"), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function priorityLabel(priorityBand: string, priorityScore: number | null) {
  return priorityScore === null ? priorityBand : `${priorityBand} (${priorityScore}/100)`;
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-IN");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
