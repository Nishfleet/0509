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
import { stablePublicId } from "~/lib/public-stable-id";
import {
  classifyDigestItemSource,
  classifyWatchEventSource,
  filterClientReportWatchEvents,
  proofMixLabel,
  summarizeDigestProofMix,
} from "~/lib/proof-classification";
import type {
  CollectionItemRecord,
  CollectionRecord,
  DigestRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

export type ExportFormat = "csv" | "json" | "slack";
const CLIENT_READY_EXPORT_SCHEMA = "client_ready_redacted_v1";

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
        items.length === 0 ? "No saved evidence yet." : "Saved evidence:",
        ...items.map(
          (item) => {
            const proofLink = proofLinkForAd(item.ad);
            const metricProof = metricProofTextForAd(item.ad);
            return `- ${stringValue(item.ad.advertiser)}: ${stringValue(item.ad.hook)} | ${stringValue(
              item.ad.offer,
            )} | CTA: ${stringValue(item.ad.cta)}${metricProof ? ` | ${metricProof}` : ""}${
              proofLink ? ` | Evidence: ${proofLink}` : ""}${
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
  const { eligibleEvents, sourceCoverage } = filterClientReportWatchEvents(events);
  const enrichedEvents = eligibleEvents.map((event) => ({
    ...event,
    intelligence: buildChangeIntelligenceSummary(event),
    classification: classifyWatchEventSource(event),
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
        `_Source coverage_: ${sourceCoverage.note}`,
        formatInsightDepthMarkdown(payload.insightDepth),
        enrichedEvents.length === 0 ? "No recent changes yet." : "Latest changes:",
        ...enrichedEvents.map(
          (event) =>
            `- ${event.title}: ${event.summary}\n  Priority: ${priorityLabel(
              event.intelligence.priorityBand,
              event.intelligence.priorityScore,
            )}\n  Source status: ${event.classification.label}\n  Source: ${event.classification.sourceTypeLabel}\n  Next move: ${event.intelligence.recommendedAction}\n  Evidence: ${event.intelligence.proofTrail}`,
        ),
      ],
    );
  }

  return csvResponse(
    "watchlist.csv",
    [
      [
        "event_type",
        "proof_status",
        "source_type",
        "title",
        "summary",
        "created_at",
        "what_changed",
        "why_it_matters",
        "urgency",
        "proof_status_label",
        "source",
        "last_seen",
        "next_action",
        "proof_trail",
        "source_url",
      ],
      ...enrichedEvents.map((event) => [
        event.eventType,
        event.classification.label,
        event.classification.sourceTypeLabel,
        event.title,
        event.summary,
        event.createdAt,
        event.title,
        event.summary,
        priorityLabel(event.intelligence.priorityBand, event.intelligence.priorityScore),
        event.classification.label,
        event.classification.sourceTypeLabel,
        event.confirmedAt ?? event.createdAt,
        event.intelligence.recommendedAction,
        event.intelligence.proofTrail,
        sourceUrlForMetadata(event.metadata),
      ]),
    ],
  );
}

export function digestExportResponse(digest: DigestRecord, format: ExportFormat) {
  const enrichedItems = digest.items.map((item) => ({
    ...item,
    intelligence: readDigestIntelligence(item.metadata),
    classification: classifyDigestItemSource(item),
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
        `_Evidence mix_: ${proofMixLabel(summarizeDigestProofMix(digest.items))}`,
        enrichedItems.length === 0 ? "No digest changes yet." : "Competitor changes:",
        ...enrichedItems.map(
          (item) =>
            `- ${item.watchlistName}: ${item.title}\n  Summary: ${item.summary}\n  Priority: ${priorityLabel(
              item.intelligence.priorityBand,
              item.intelligence.priorityScore,
            )}\n  Source status: ${item.classification.label}\n  Source: ${item.classification.sourceTypeLabel}\n  Next move: ${item.intelligence.recommendedAction}\n  Evidence: ${item.intelligence.proofTrail}`,
        ),
      ],
    );
  }

  return csvResponse(
    "digest.csv",
    [
      [
        "watchlist",
        "event_type",
        "title",
        "summary",
        "what_changed",
        "why_it_matters",
        "urgency",
        "proof_status",
        "source",
        "last_seen",
        "next_action",
        "proof_trail",
        "source_url",
      ],
      ...enrichedItems.map((item) => [
        item.watchlistName,
        item.eventType,
        item.title,
        item.summary,
        item.title,
        item.summary,
        priorityLabel(item.intelligence.priorityBand, item.intelligence.priorityScore),
        item.classification.label,
        item.classification.sourceTypeLabel,
        readMetadataString(item.metadata, "confirmedAt") ?? readMetadataString(item.metadata, "capturedAt") ?? readMetadataString(item.metadata, "createdAt") ?? item.createdAt,
        item.intelligence.recommendedAction,
        item.intelligence.proofTrail,
        sourceUrlForMetadata(item.metadata),
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
    schemaVersion: CLIENT_READY_EXPORT_SCHEMA,
    exportPolicy: redactedExportPolicy("all_saved_collection_items"),
    generatedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      description: collection.description,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    },
    insightDepth,
    items: items.map((item) => ({
      id: stablePublicId("collection_item", [
        item.ad.metaAdId,
        item.createdAt,
        item.note,
      ]),
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
  const { eligibleEvents, sourceCoverage } = filterClientReportWatchEvents(events);
  const insightDepth = buildWatchlistInsightDepth(eligibleEvents);
  const enrichedEvents = eligibleEvents.map((event) => ({
    ...event,
    intelligence: buildChangeIntelligenceSummary(event),
    classification: classifyWatchEventSource(event),
  }));

  return {
    resourceType: "watchlist",
    schemaVersion: CLIENT_READY_EXPORT_SCHEMA,
    exportPolicy: redactedExportPolicy("verified_proof_watch_events_only"),
    generatedAt: new Date().toISOString(),
    watchlist: {
      name: watchlist.name,
      targetType: watchlist.targetType,
      targetLabel: watchlist.targetLabel,
      targetCountry: watchlist.targetCountry,
      isActive: watchlist.isActive,
      lastScannedAt: watchlist.lastScannedAt,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
    },
    sourceCoverage,
    insightDepth,
    events: enrichedEvents.map((event) => ({
      id: stablePublicId("watch_event", [
        event.eventType,
        event.title,
        event.createdAt,
        event.adId,
      ]),
      eventType: event.eventType,
      status: event.status,
      proofStatus: event.classification.status,
      proofStatusLabel: event.classification.label,
      sourceTypeLabel: event.classification.sourceTypeLabel,
      title: event.title,
      summary: event.summary,
      importanceScore: event.importanceScore,
      confirmedAt: event.confirmedAt,
      createdAt: event.createdAt,
      intelligence: event.intelligence,
    })),
  };
}

export function buildDigestExportPayload(digest: DigestRecord) {
  const insightDepth = buildDigestInsightDepth(digest.items);
  const enrichedItems = digest.items.map((item) => ({
    ...item,
    intelligence: readDigestIntelligence(item.metadata),
    classification: classifyDigestItemSource(item),
  }));

  return {
    resourceType: "digest",
    schemaVersion: CLIENT_READY_EXPORT_SCHEMA,
    exportPolicy: redactedExportPolicy("digest_items_with_source_labels"),
    generatedAt: new Date().toISOString(),
    digest: {
      id: stablePublicId("digest", [
        digest.periodStart,
        digest.periodEnd,
        digest.createdAt,
      ]),
      periodStart: digest.periodStart,
      periodEnd: digest.periodEnd,
      createdAt: digest.createdAt,
      delivery: digest.delivery
        ? {
            status: digest.delivery.status,
            provider: digest.delivery.provider,
            deliveredAt: digest.delivery.deliveredAt,
          }
        : null,
    },
    proofMix: summarizeDigestProofMix(digest.items),
    insightDepth,
    items: enrichedItems.map((item) => ({
      id: stablePublicId("digest_item", [
        digest.periodStart,
        item.watchlistName,
        item.eventType,
        item.title,
        item.createdAt,
      ]),
      watchlistName: item.watchlistName,
      eventType: item.eventType,
      proofStatus: item.classification.status,
      proofStatusLabel: item.classification.label,
      sourceTypeLabel: item.classification.sourceTypeLabel,
      title: item.title,
      summary: item.summary,
      createdAt: item.createdAt,
      intelligence: item.intelligence,
    })),
  };
}

function redactedExportPolicy(eventPolicy: string) {
  return {
    eventPolicy,
    redaction: "Internal IDs, owner IDs, provider payloads, recipient emails, and raw metadata are omitted.",
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

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceUrlForMetadata(metadata: Record<string, unknown> | undefined) {
  return readHttpUrl(metadata?.sourceUrl)
    ?? readHttpUrl(metadata?.proofUrl)
    ?? readHttpUrl(metadata?.landingPageUrl)
    ?? readHttpUrl(metadata?.websiteUrl)
    ?? readHttpUrl(metadata?.websiteProofUrl)
    ?? readHttpUrl(metadata?.canonicalUrl)
    ?? "";
}

function readHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
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
