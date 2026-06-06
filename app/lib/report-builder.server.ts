import {
  formatAnalysisSourceLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
  formatLandingPageSignalValue,
} from "~/lib/landing-page-display";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import {
  buildCollectionInsightDepth,
  buildWatchlistInsightDepth,
} from "~/lib/insight-depth";
import {
  createReportId,
  type ReportDocument,
  type ReportField,
  type ReportResourceType,
  type ReportRow,
} from "~/lib/report";
import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  WatchEventRecord,
  WatchlistRecord,
} from "~/lib/types";

const ANALYSIS_FIELD_PRIORITY = [
  "hook",
  "offer",
  "cta",
  "format",
  "language_label",
  "destination_type",
  "ocr_text",
  "landing_page_headline_summary",
  "cta_text",
  "price_text",
  "form_present",
] as const;

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  cta: "CTA",
  cta_text: "CTA text",
  ocr_text: "OCR text",
};

export function buildCollectionReport(input: {
  collection: CollectionRecord;
  items: CollectionItemRecord[];
  generatedAt?: string;
}): ReportDocument {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rows = input.items.map((item) =>
    buildReportRow("collection", item.id, item.ad, {
      note: item.note,
      tags: item.tags,
    }),
  );

  return {
    kind: "report",
    reportId: createReportId("collection", input.collection.id),
    resourceType: "collection",
    resourceId: input.collection.id,
    title: input.collection.name,
    subtitle:
      input.collection.description ??
      "Saved ads compiled into a client-ready review.",
    summary: `${rows.length} saved ads with creative, language, and landing-page context.`,
    generatedAt,
    stats: [
      { label: "Ads", value: String(rows.length) },
      { label: "Countries", value: summarizeDistinct(rows.flatMap((row) => row._meta.countries)) },
      { label: "Platforms", value: summarizeDistinct(rows.flatMap((row) => row._meta.platforms)) },
    ],
    insightDepth: buildCollectionInsightDepth(input.items),
    rows: rows.map(stripInternalMeta),
  };
}

export function buildWatchlistReport(input: {
  watchlist: WatchlistRecord;
  events: WatchEventRecord[];
  adsById: Map<string, AdRecord>;
  generatedAt?: string;
}): ReportDocument {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rows = input.events.map((event) => {
    const ad = event.adId ? input.adsById.get(event.adId) ?? null : null;
    const intelligence = buildChangeIntelligenceSummary(event);

    return buildReportRow("watchlist", event.id, ad, {
      event: {
        typeLabel: event.eventType.replaceAll("_", " "),
        title: event.title,
        summary: event.summary,
        createdAt: event.createdAt,
        priorityScore: intelligence.priorityScore,
        priorityBand: intelligence.priorityBand,
        recommendedAction: intelligence.recommendedAction,
        proofTrail: intelligence.proofTrail,
      },
      advertiserFallback: readEventAdvertiser(event),
    });
  });

  const linkedAds = rows.filter((row) => row._meta.hasLinkedAd).length;
  const eventTypes = summarizeDistinct(
    input.events.map((event) => event.eventType.replaceAll("_", " ")),
  );

  return {
    kind: "report",
    reportId: createReportId("watchlist", input.watchlist.id),
    resourceType: "watchlist",
    resourceId: input.watchlist.id,
    title: input.watchlist.name,
    subtitle: `${input.watchlist.targetType.replaceAll("_", " ")} · ${input.watchlist.targetLabel}`,
    summary: `${rows.length} recent watch events with linked ad context where available.`,
    generatedAt,
    stats: [
      { label: "Events", value: String(rows.length) },
      { label: "Linked ads", value: String(linkedAds) },
      { label: "Event types", value: eventTypes },
    ],
    insightDepth: buildWatchlistInsightDepth(input.events),
    rows: rows.map(stripInternalMeta),
  };
}

function buildReportRow(
  reportType: ReportResourceType,
  id: string,
  ad: AdRecord | null,
  options: {
    note?: string | null;
    tags?: string[];
    event?: ReportRow["event"];
    advertiserFallback?: string | null;
  },
) {
  const creativeText = ad?.creativeText?.trim() || findAnalysisFieldValue(ad, "ocr_text");
  const landingPageHeadline =
    ad?.landingPage?.rawHeadline || findAnalysisFieldValue(ad, "landing_page_headline_summary");
  const reportRow = {
    id,
    advertiser: ad?.advertiser ?? options.advertiserFallback ?? "Ad context unavailable",
    previewHeadline: ad?.previewHeadline ?? options.event?.title ?? "Preview unavailable",
    offer: ad?.offer ?? "Offer unavailable",
    cta: ad?.cta ?? "CTA unavailable",
    formatLabel: ad?.format ?? "unknown",
    languageLabel: ad?.languageLabel ?? "Language unavailable",
    previewImageUrl: ad?.adSnapshotUrl ?? null,
    creativeText: creativeText || "Creative text unavailable",
    translatedText: findAnalysisFieldValue(ad, "translated_text") || "Translation unavailable",
    landingPage: {
      url: ad?.landingPage?.canonicalUrl ?? ad?.landingPageUrl ?? "Landing page unavailable",
      headline: landingPageHeadline || "Landing page headline unavailable",
      captureLabel: formatCaptureMethodLabel(ad?.landingPage?.captureMethod),
      signals: [
        {
          label: "CTA",
          value: formatLandingPageSignalValue(ad?.landingPage?.ctaText),
        },
        {
          label: "Price",
          value: formatLandingPageSignalValue(ad?.landingPage?.priceText),
        },
        {
          label: "Form present",
          value: formatLandingPageFormValue(ad?.landingPage?.formPresent),
        },
      ],
    },
    analysisFields: buildAnalysisFieldList(ad),
    tags: options.tags ?? [],
    note: options.note ?? null,
    event: options.event,
    _meta: {
      reportType,
      countries: ad?.countries ?? [],
      platforms: ad?.platforms ?? [],
      hasLinkedAd: Boolean(ad),
    },
  };

  return reportRow;
}

function buildAnalysisFieldList(ad: AdRecord | null): ReportField[] {
  if (!ad) {
    return [];
  }

  const ordered = new Map<string, ReportField>();

  for (const key of ANALYSIS_FIELD_PRIORITY) {
    const field = ad.analysisFields.find(
      (candidate) => candidate.fieldKey === key && candidate.fieldValue.trim(),
    );
    if (!field) {
      continue;
    }

    ordered.set(field.fieldKey, {
      label: formatFieldLabel(field.fieldKey),
      value: normalizeFieldValue(field.fieldKey, field.fieldValue),
      sourceLabel: formatAnalysisSourceLabel(field.provenanceSource),
    });
  }

  for (const field of ad.analysisFields) {
    if (!field.fieldValue.trim() || ordered.has(field.fieldKey)) {
      continue;
    }

    ordered.set(field.fieldKey, {
      label: formatFieldLabel(field.fieldKey),
      value: normalizeFieldValue(field.fieldKey, field.fieldValue),
      sourceLabel: formatAnalysisSourceLabel(field.provenanceSource),
    });
  }

  return [...ordered.values()];
}

function findAnalysisFieldValue(ad: AdRecord | null | undefined, fieldKey: string) {
  return ad?.analysisFields.find((field) => field.fieldKey === fieldKey)?.fieldValue.trim() ?? "";
}

function formatFieldLabel(fieldKey: string) {
  if (FIELD_LABEL_OVERRIDES[fieldKey]) {
    return FIELD_LABEL_OVERRIDES[fieldKey];
  }

  return fieldKey
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeFieldValue(fieldKey: string, fieldValue: string) {
  if (fieldKey === "form_present") {
    return formatLandingPageFormValue(fieldValue === "true");
  }

  return fieldValue;
}

function summarizeDistinct(values: string[]) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length > 0 ? unique.join(", ") : "None";
}

function readEventAdvertiser(event: WatchEventRecord) {
  return typeof event.metadata.advertiser === "string" ? event.metadata.advertiser : null;
}

function stripInternalMeta(
  row: ReturnType<typeof buildReportRow>,
): ReportRow {
  const { _meta, ...reportRow } = row;
  return reportRow;
}
