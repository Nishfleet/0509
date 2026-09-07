import type {
  AnalysisFieldInput,
  CollectionItemRecord,
  DigestItemRecord,
  WatchEventRecord,
} from "~/lib/types";

export interface InsightDepthSummary {
  topHooks: InsightCount[];
  mediaMix: InsightCount[];
  campaignDurations: InsightCount[];
  metricProof: InsightCount[];
  creativeTimeline: InsightTimelineItem[];
  landingPageHistory: InsightTimelineItem[];
}

export interface InsightCount {
  label: string;
  count: number;
  detail: string;
}

export interface InsightTimelineItem {
  label: string;
  detail: string;
  timestamp: string;
}

export function emptyInsightDepthSummary(): InsightDepthSummary {
  return {
    topHooks: [{ label: "Pending", count: 0, detail: "No repeated hooks yet." }],
    mediaMix: [{ label: "Pending", count: 0, detail: "No channel mix yet." }],
    campaignDurations: [{ label: "Pending", count: 0, detail: "No duration evidence yet." }],
    metricProof: [{ label: "Pending", count: 0, detail: "No spend, reach, or impression evidence yet." }],
    creativeTimeline: [],
    landingPageHistory: [],
  };
}

export function safeInsightDepthSummary(value: unknown): InsightDepthSummary {
  if (!value || typeof value !== "object") {
    return emptyInsightDepthSummary();
  }

  const candidate = value as Partial<InsightDepthSummary>;
  return {
    topHooks: Array.isArray(candidate.topHooks)
      ? candidate.topHooks
      : emptyInsightDepthSummary().topHooks,
    mediaMix: Array.isArray(candidate.mediaMix)
      ? candidate.mediaMix
      : emptyInsightDepthSummary().mediaMix,
    campaignDurations: Array.isArray(candidate.campaignDurations)
      ? candidate.campaignDurations
      : emptyInsightDepthSummary().campaignDurations,
    metricProof: Array.isArray(candidate.metricProof)
      ? candidate.metricProof
      : emptyInsightDepthSummary().metricProof,
    creativeTimeline: Array.isArray(candidate.creativeTimeline)
      ? candidate.creativeTimeline
      : [],
    landingPageHistory: Array.isArray(candidate.landingPageHistory)
      ? candidate.landingPageHistory
      : [],
  };
}

type InsightSource =
  | {
      kind: "ad";
      advertiser: string;
      hook: string;
      platforms: unknown;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      active: boolean;
      timestamp: string | null;
      detail: string;
      landingPageDetail: string | null;
      analysisFields: AnalysisFieldInput[];
    }
  | {
      kind: "event";
      title: string;
      eventType: string;
      summary: string;
      timestamp: string;
      metadata: Record<string, unknown>;
    };

export function buildCollectionInsightDepth(items: CollectionItemRecord[]): InsightDepthSummary {
  return buildInsightDepth(
    items.map((item) => ({
      kind: "ad",
      advertiser: item.ad.advertiser,
      hook: item.ad.hook,
      platforms: item.ad.platforms,
      firstSeenAt: item.ad.firstSeenAt,
      lastSeenAt: lastObservedAtForAd(item),
      active: item.ad.active,
      timestamp: item.ad.lastSeenAt ?? item.ad.firstSeenAt ?? item.createdAt,
      detail: item.ad.offer || item.ad.previewHeadline || item.note || "Saved evidence",
      landingPageDetail: landingPageDetailForAd(item),
      analysisFields: normalizeAnalysisFields(item.ad.analysisFields),
    })),
  );
}

export function buildWatchlistInsightDepth(events: WatchEventRecord[]): InsightDepthSummary {
  return buildInsightDepth(
    events.map((event) => ({
      kind: "event",
      title: event.title,
      eventType: event.eventType,
      summary: event.summary,
      timestamp: event.confirmedAt ?? event.createdAt,
      metadata: event.metadata,
    })),
  );
}

export function buildDigestInsightDepth(items: DigestItemRecord[]): InsightDepthSummary {
  return buildInsightDepth(
    items.map((item) => ({
      kind: "event",
      title: item.title,
      eventType: item.eventType,
      summary: item.summary,
      timestamp: item.createdAt,
      metadata: item.metadata,
    })),
  );
}

export function formatInsightDepthMarkdown(summary: InsightDepthSummary) {
  return [
    "*Insight depth*",
    markdownSection("Top hooks", summary.topHooks),
    markdownSection("Media mix", summary.mediaMix),
    markdownSection("Observed campaign duration", summary.campaignDurations),
    markdownSection("Metric evidence", summary.metricProof),
    markdownTimeline("Creative timeline", summary.creativeTimeline),
    markdownTimeline("Landing-page history", summary.landingPageHistory),
  ].join("\n\n");
}

export interface DigestTrendLine {
  text: string;
}

/**
 * Compact weekly-digest trend lines from sourced digest items only.
 * Returns [] when there is nothing honest to summarize.
 */
export function buildDigestTrendRollups(
  items: Array<{
    eventType?: string;
    title?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }>,
): DigestTrendLine[] {
  if (items.length === 0) {
    return [];
  }

  const lines: DigestTrendLine[] = [];
  const typeCounts = new Map<string, number>();

  for (const item of items) {
    const key = trendBucketForEventType(item.eventType);
    if (!key) continue;
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  }

  for (const [bucket, count] of [...typeCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    lines.push({ text: formatTrendCountLine(bucket, count) });
  }

  const depth = buildDigestInsightDepth(
    items.map((item, index) => ({
      id: `trend-${index}`,
      digestRunId: "trend",
      watchlistId: "trend",
      watchlistName: "trend",
      eventType: (item.eventType ?? "ad_new") as DigestItemRecord["eventType"],
      title: item.title ?? "Change",
      summary: item.summary ?? "",
      metadata: item.metadata ?? {},
      createdAt: item.createdAt ?? new Date(0).toISOString(),
    })),
  );

  const topHook = depth.topHooks[0];
  if (topHook && topHook.count > 0 && topHook.label !== "Pending") {
    lines.push({
      text:
        topHook.count === 1
          ? `Top hook: ${topHook.label}`
          : `Top hook (${topHook.count}×): ${topHook.label}`,
    });
  }

  const topChannel = depth.mediaMix[0];
  if (topChannel && topChannel.count > 0 && topChannel.label !== "Pending") {
    lines.push({
      text:
        topChannel.count === 1
          ? `Most common channel: ${topChannel.label}`
          : `Most common channel: ${topChannel.label} (${topChannel.count})`,
    });
  }

  return lines.slice(0, 5);
}

function trendBucketForEventType(eventType: string | undefined) {
  switch (eventType) {
    case "landing_page_offer_changed":
      return "pricing";
    case "landing_page_cta_changed":
      return "cta";
    case "landing_page_headline_changed":
      return "headline";
    case "landing_page_url_changed":
      return "destination";
    case "landing_page_form_changed":
      return "form";
    case "ad_new":
      return "new_ad";
    case "ad_inactive":
      return "inactive_ad";
    default:
      return null;
  }
}

function formatTrendCountLine(bucket: string, count: number) {
  const times = `${count}×`;
  switch (bucket) {
    case "pricing":
      return `Changed pricing ${times} this period`;
    case "cta":
      return `Changed CTAs ${times} this period`;
    case "headline":
      return `Changed headlines ${times} this period`;
    case "destination":
      return `Changed destinations ${times} this period`;
    case "form":
      return `Changed forms ${times} this period`;
    case "new_ad":
      return count === 1 ? "1 new ad spotted this period" : `${count} new ads spotted this period`;
    case "inactive_ad":
      return count === 1
        ? "1 ad went inactive this period"
        : `${count} ads went inactive this period`;
    default:
      return `${count} changes this period`;
  }
}

function buildInsightDepth(sources: InsightSource[]): InsightDepthSummary {
  return {
    topHooks: summarizeCounts(readHookLabels(sources), "No repeated hooks yet."),
    mediaMix: summarizeCounts(readMediaLabels(sources), "No channel mix yet."),
    campaignDurations: summarizeCounts(readCampaignDurationLabels(sources), "No duration evidence yet."),
    metricProof: summarizeCounts(readMetricProofLabels(sources), "No spend, reach, or impression evidence yet."),
    creativeTimeline: readCreativeTimeline(sources),
    landingPageHistory: readLandingPageHistory(sources),
  };
}

function readHookLabels(sources: InsightSource[]) {
  return sources.flatMap((source) => {
    if (source.kind === "ad") {
      return source.hook ? [{ label: source.hook, detail: source.advertiser }] : [];
    }

    const metadataHook = readMetadataString(source.metadata, "hook");
    const metadataOffer = readMetadataString(source.metadata, "offer");
    const label = metadataHook ?? metadataOffer;
    return label ? [{ label, detail: source.title }] : [];
  });
}

function readMediaLabels(sources: InsightSource[]) {
  return sources.flatMap((source) => {
    if (source.kind === "ad") {
      const platforms = normalizeStringArray(source.platforms);
      return platforms.length > 0
        ? platforms.map((platform) => ({ label: platform, detail: source.advertiser }))
        : [{ label: "Meta", detail: source.advertiser }];
    }

    return [{ label: labelForEventChannel(source.eventType), detail: source.title }];
  });
}

function readCampaignDurationLabels(sources: InsightSource[]) {
  return sources.flatMap((source) => {
    if (source.kind !== "ad") {
      return [];
    }

    const durationDays = observedDurationDays(source.firstSeenAt, source.lastSeenAt);
    if (durationDays === null) {
      return [];
    }

    return [
      {
        label: campaignDurationBucket(durationDays, source.active),
        detail: [
          source.advertiser,
          `${durationDays} observed day${durationDays === 1 ? "" : "s"}`,
          source.active ? "active" : "inactive",
        ].join(" - "),
      },
    ];
  });
}

function readMetricProofLabels(sources: InsightSource[]) {
  return sources.flatMap((source) => {
    if (source.kind !== "ad") {
      return [];
    }

    const metricFields = source.analysisFields
      .map(metricFieldForAnalysis)
      .filter((field): field is { label: string; value: string } => Boolean(field));
    if (metricFields.length === 0) {
      return [];
    }

    const channel = normalizeStringArray(source.platforms)[0] ?? "Manual evidence";
    return [
      {
        label: source.advertiser,
        detail: `${metricFields.map((field) => `${field.label}: ${field.value}`).join(" | ")} - ${channel}`,
      },
    ];
  });
}

function readCreativeTimeline(sources: InsightSource[]): InsightTimelineItem[] {
  return sources
    .map((source) => {
      if (source.kind === "ad") {
        return {
          label: source.advertiser,
          detail: source.detail,
          timestamp: source.timestamp ?? "",
        };
      }

      return {
        label: source.title,
        detail: source.summary,
        timestamp: source.timestamp,
      };
    })
    .filter((item) => item.timestamp)
    .sort(sortTimelineDesc)
    .slice(0, 5);
}

function readLandingPageHistory(sources: InsightSource[]): InsightTimelineItem[] {
  return sources
    .flatMap((source) => {
      if (source.kind === "ad") {
        return source.landingPageDetail && source.timestamp
          ? [
              {
                label: "Landing-page context",
                detail: source.landingPageDetail,
                timestamp: source.timestamp,
              },
            ]
          : [];
      }

      if (!source.eventType.startsWith("landing_page_")) {
        return [];
      }

      const from = readMetadataString(source.metadata, "from");
      const to = readMetadataString(source.metadata, "to");
      const diff = from && to ? `${from} -> ${to}` : source.summary;
      return [
        {
          label: source.title,
          detail: diff,
          timestamp: source.timestamp,
        },
      ];
    })
    .sort(sortTimelineDesc)
    .slice(0, 5);
}

function summarizeCounts(
  entries: Array<{ label: string; detail: string }>,
  emptyDetail: string,
): InsightCount[] {
  if (entries.length === 0) {
    return [{ label: "Pending", count: 0, detail: emptyDetail }];
  }

  const counts = new Map<string, { count: number; details: Set<string> }>();
  for (const entry of entries) {
    const label = entry.label.trim();
    if (!label) {
      continue;
    }
    const current = counts.get(label) ?? { count: 0, details: new Set<string>() };
    current.count += 1;
    if (entry.detail.trim()) {
      current.details.add(entry.detail.trim());
    }
    counts.set(label, current);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({
      label,
      count: value.count,
      detail: [...value.details].slice(0, 3).join(", ") || "Evidence pending",
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function landingPageDetailForAd(item: CollectionItemRecord) {
  const landingPage = item.ad.landingPage;
  if (!landingPage) {
    return item.ad.landingPageUrl ? `Destination tracked: ${item.ad.landingPageUrl}` : null;
  }

  return [
    landingPage.rawHeadline || landingPage.normalizedHeadline,
    landingPage.ctaText ? `CTA: ${landingPage.ctaText}` : null,
    landingPage.priceText ? `Price: ${landingPage.priceText}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function lastObservedAtForAd(item: CollectionItemRecord) {
  const lastSeenAt = item.ad.lastSeenAt;
  if (!item.ad.active || !item.ad.firstSeenAt) {
    return lastSeenAt;
  }

  const firstSeenMs = item.ad.firstSeenAt ? Date.parse(item.ad.firstSeenAt) : Number.NaN;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  if (!Number.isNaN(firstSeenMs) && !Number.isNaN(lastSeenMs) && lastSeenMs > firstSeenMs) {
    return lastSeenAt;
  }

  const savedAtMs = Date.parse(item.createdAt);
  if (Number.isNaN(firstSeenMs) || Number.isNaN(savedAtMs) || savedAtMs <= firstSeenMs) {
    return lastSeenAt;
  }

  return item.createdAt;
}

function markdownSection(title: string, items: InsightCount[]) {
  return [
    `_${title}_`,
    ...items.map((item) => `- ${item.label}${item.count > 0 ? ` (${item.count})` : ""}: ${item.detail}`),
  ].join("\n");
}

function markdownTimeline(title: string, items: InsightTimelineItem[]) {
  return [
    `_${title}_`,
    ...(items.length > 0
      ? items.map((item) => `- ${item.label}: ${item.detail} (${dateLabel(item.timestamp)})`)
      : ["- Pending: No evidence yet."]),
  ].join("\n");
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function normalizeAnalysisFields(value: unknown): AnalysisFieldInput[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is AnalysisFieldInput =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as AnalysisFieldInput).fieldKey === "string" &&
          typeof (item as AnalysisFieldInput).fieldValue === "string",
      )
    : [];
}

function metricFieldForAnalysis(field: AnalysisFieldInput) {
  if (!field.fieldValue.trim()) {
    return null;
  }

  if (field.fieldKey === "observed_spend") {
    return { label: "Spend", value: field.fieldValue.trim() };
  }
  if (field.fieldKey === "observed_impressions") {
    return { label: "Impressions", value: field.fieldValue.trim() };
  }
  if (field.fieldKey === "observed_reach") {
    return { label: "Reach", value: field.fieldValue.trim() };
  }

  return null;
}

function observedDurationDays(firstSeenAt: string | null, lastSeenAt: string | null) {
  if (!firstSeenAt || !lastSeenAt) {
    return null;
  }

  const firstSeenMs = Date.parse(firstSeenAt);
  const lastSeenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(firstSeenMs) || Number.isNaN(lastSeenMs) || lastSeenMs < firstSeenMs) {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((lastSeenMs - firstSeenMs) / dayMs));
}

function campaignDurationBucket(durationDays: number, active: boolean) {
  if (active && durationDays >= 30) {
    return "Long-running active campaign";
  }
  if (durationDays >= 30) {
    return "Long-running campaign";
  }
  if (durationDays >= 14) {
    return "Multi-week run";
  }
  if (durationDays >= 7) {
    return "One-week run";
  }
  return "Short test";
}

function labelForEventChannel(eventType: string) {
  return eventType.startsWith("landing_page_") ? "Landing page" : "Meta";
}

function sortTimelineDesc(a: InsightTimelineItem, b: InsightTimelineItem) {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

// Markdown exports must stay locale-neutral: UTC day boundary, en-GB format.
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
