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
import { proofLinkForAd } from "~/lib/proof-link";
import type {
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

export type ExportFormat = "csv" | "json" | "slack";

export function exportFormatForRequest(
  request: Request,
  defaultFormat: ExportFormat = "csv",
): ExportFormat {
  const url = new URL(request.url);
  const format = url.searchParams.get("format")?.toLowerCase();
  if (format === "csv" || format === "json" || format === "slack") {
    return format;
  }
  return defaultFormat;
}

export function collectionExportResponse(
  collection: CollectionRecord,
  items: CollectionItemRecord[],
  format: ExportFormat,
) {
  if (format === "json") {
    const payload = buildCollectionExportPayload(collection, items);
    return jsonResponse("collection.json", payload);
  }

  if (format === "slack") {
    const payload = buildCollectionExportPayload(collection, items);
    return slackResponse(
      "collection.slack.md",
      [
        `*Five to Nine board: ${collection.name}*`,
        collection.description ? collection.description : null,
        formatInsightDepthMarkdown(payload.insightDepth),
        items.length === 0 ? "No saved proof yet." : "Saved proof:",
        ...items.map(
          (item) => {
            const proofLink = proofLinkForAd(item.ad);
            const metricProof = metricProofTextForAd(item.ad);
            return `- ${stringValue(item.ad.advertiser)}: ${stringValue(item.ad.hook)} | ${stringValue(
              item.ad.offer,
            )} | CTA: ${stringValue(item.ad.cta)}${metricProof ? ` | ${metricProof}` : ""}${
              proofLink ? ` | Proof: ${proofLink}` : ""}${
              item.note ? ` | Note: ${item.note}` : ""
            }`;
          },
        ),
      ],
    );
  }

  return csvResponse(
    "collection.csv",
    [
      ["advertiser", "hook", "offer", "cta", "metric_proof", "proof_url", "tags", "note"],
      ...items.map((item) => [
        stringValue(item.ad.advertiser),
        stringValue(item.ad.hook),
        stringValue(item.ad.offer),
        stringValue(item.ad.cta),
        metricProofTextForAd(item.ad),
        proofLinkForAd(item.ad) ?? "",
        item.tags.join("|"),
        item.note ?? "",
      ]),
    ],
  );
}

export function watchlistExportResponse(
  watchlist: WatchlistRecord,
  events: WatchEventRecord[],
  format: ExportFormat,
) {
  const enrichedEvents = events.map((event) => ({
    ...event,
    intelligence: buildChangeIntelligenceSummary(event),
  }));

  if (format === "json") {
    const payload = buildWatchlistExportPayload(watchlist, events);
    return jsonResponse("watchlist.json", payload);
  }

  if (format === "slack") {
    const payload = buildWatchlistExportPayload(watchlist, events);
    return slackResponse(
      "watchlist.slack.md",
      [
        `*Five to Nine watchlist: ${watchlist.name}*`,
        `Target: ${watchlist.targetLabel}`,
        formatInsightDepthMarkdown(payload.insightDepth),
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

export function digestExportResponse(digest: DigestRecord, format: ExportFormat) {
  const enrichedItems = digest.items.map((item) => ({
    ...item,
    intelligence: readDigestIntelligence(item.metadata),
  }));

  if (format === "json") {
    const payload = buildDigestExportPayload(digest);
    return jsonResponse("digest.json", payload);
  }

  if (format === "slack") {
    const payload = buildDigestExportPayload(digest);
    return slackResponse(
      "digest.slack.md",
      [
        `*Five to Nine digest: ${dateLabel(digest.periodStart)} to ${dateLabel(digest.periodEnd)}*`,
        formatInsightDepthMarkdown(payload.insightDepth),
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

export function buildCollectionExportPayload(
  collection: CollectionRecord,
  items: CollectionItemRecord[],
) {
  const insightDepth = buildCollectionInsightDepth(items);
  return {
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
      proofUrl: proofLinkForAd(item.ad),
      metricProof: metricProofForAd(item.ad),
      tags: item.tags,
      note: item.note,
      savedAt: item.createdAt,
    })),
  };
}

export function buildWatchlistExportPayload(
  watchlist: WatchlistRecord,
  events: WatchEventRecord[],
) {
  const insightDepth = buildWatchlistInsightDepth(events);
  const enrichedEvents = events.map((event) => ({
    ...event,
    intelligence: buildChangeIntelligenceSummary(event),
  }));

  return {
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
  };
}

export function buildDigestExportPayload(digest: DigestRecord) {
  const insightDepth = buildDigestInsightDepth(digest.items);
  const enrichedItems = digest.items.map((item) => ({
    ...item,
    intelligence: readDigestIntelligence(item.metadata),
  }));

  return {
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
  };
}

function csvResponse(filename: string, rows: string[][]) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => `"${neutralizeCsvFormula(cell).replaceAll('"', '""')}"`)
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

function neutralizeCsvFormula(cell: string) {
  return /^[\t\r=+\-@]/.test(cell.trimStart()) ? `'${cell}` : cell;
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

// Exports must stay locale-neutral: UTC day boundary, en-GB format.
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value),
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function metricProofForAd(ad: CollectionItemRecord["ad"]) {
  const metrics = {
    spend: "",
    impressions: "",
    reach: "",
  };

  for (const field of Array.isArray(ad.analysisFields) ? ad.analysisFields : []) {
    if (field.fieldKey === "observed_spend") {
      metrics.spend = stringValue(field.fieldValue);
    } else if (field.fieldKey === "observed_impressions") {
      metrics.impressions = stringValue(field.fieldValue);
    } else if (field.fieldKey === "observed_reach") {
      metrics.reach = stringValue(field.fieldValue);
    }
  }

  return metrics;
}

function metricProofTextForAd(ad: CollectionItemRecord["ad"]) {
  const metrics = metricProofForAd(ad);
  return [
    metrics.spend ? `Spend: ${metrics.spend}` : null,
    metrics.impressions ? `Impressions: ${metrics.impressions}` : null,
    metrics.reach ? `Reach: ${metrics.reach}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}
