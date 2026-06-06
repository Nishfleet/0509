import type {
  CollectionItemRecord,
  DigestItemRecord,
  WatchEventRecord,
} from "~/lib/types";

export interface InsightDepthSummary {
  topHooks: InsightCount[];
  mediaMix: InsightCount[];
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
      timestamp: string | null;
      detail: string;
      landingPageDetail: string | null;
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
      timestamp: item.ad.lastSeenAt ?? item.ad.firstSeenAt ?? item.createdAt,
      detail: item.ad.offer || item.ad.previewHeadline || item.note || "Saved proof",
      landingPageDetail: landingPageDetailForAd(item),
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
    markdownTimeline("Creative timeline", summary.creativeTimeline),
    markdownTimeline("Landing-page history", summary.landingPageHistory),
  ].join("\n\n");
}

function buildInsightDepth(sources: InsightSource[]): InsightDepthSummary {
  return {
    topHooks: summarizeCounts(readHookLabels(sources), "No repeated hooks yet."),
    mediaMix: summarizeCounts(readMediaLabels(sources), "No channel mix yet."),
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

function labelForEventChannel(eventType: string) {
  return eventType.startsWith("landing_page_") ? "Landing page" : "Meta";
}

function sortTimelineDesc(a: InsightTimelineItem, b: InsightTimelineItem) {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}
