import {
  formatAnalysisSourceLabel,
  formatCaptureMethodLabel,
  formatLandingPageFormValue,
} from "~/lib/landing-page-display";
import { formatWatchEventTypeLabel } from "~/lib/watch-event-display";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import {
  buildCollectionInsightDepth,
  buildWatchlistInsightDepth,
} from "~/lib/insight-depth";
import { proofLinkForAd } from "~/lib/proof-link";
import { stablePublicId } from "~/lib/public-stable-id";
import {
  classifyWatchEventSource,
  filterClientReportWatchEvents,
} from "~/lib/proof-classification";
import {
  createReportId,
	type ReportAiWeeklySummary,
  type ReportDocument,
  type ReportField,
  type ReportResourceType,
  type ReportRow,
} from "~/lib/report";
import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
  ProofCaptureRecord,
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
  "channel",
  "proof_url",
  "ocr_text",
  "landing_page_headline_summary",
  "cta_text",
  "price_text",
  "form_present",
  "note",
] as const;

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  cta: "CTA",
  cta_text: "CTA text",
  ocr_text: "OCR text",
  proof_url: "Evidence URL",
};

export function buildCollectionReport(input: {
  collection: CollectionRecord;
  items: CollectionItemRecord[];
  generatedAt?: string;
}): ReportDocument {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const rows = input.items.map((item) =>
    buildReportRow("collection", stablePublicId("row", [
      item.ad.metaAdId,
      item.createdAt,
      item.note,
    ]), item.ad, {
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
  proofCapturesByEventId?: Map<string, ProofCaptureRecord>;
	// Latest stored digest-run AI paragraph proven exclusive to this watchlist.
	// Never sourced from a fresh AI call; omitted when none is stored.
	aiWeeklySummary?: ReportAiWeeklySummary | null;
  generatedAt?: string;
}): ReportDocument {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const { eligibleEvents, sourceCoverage } = filterClientReportWatchEvents(input.events);
  const rows = eligibleEvents.map((event) => {
    const ad = event.adId ? input.adsById.get(event.adId) ?? null : null;
    const proofCapture = input.proofCapturesByEventId?.get(event.id) ?? null;
    const intelligence = buildChangeIntelligenceSummary(event);
    const classification = classifyWatchEventSource(event);

    return buildReportRow("watchlist", stablePublicId("row", [
      event.eventType,
      event.title,
      event.createdAt,
      event.adId,
    ]), ad, {
      event: {
				typeLabel: formatWatchEventTypeLabel(event.eventType),
        title: event.title,
        summary: event.summary,
        createdAt: event.createdAt,
        priorityScore: intelligence.priorityScore,
        priorityBand: intelligence.priorityBand,
        recommendedAction: intelligence.recommendedAction,
        proofTrail: intelligence.proofTrail,
        proofStatusLabel: classification.label,
        sourceTypeLabel: classification.sourceTypeLabel,
        sourceUrl:
          proofCapture
            ? readProofString(proofCapture, "canonicalUrl")
            : sourceUrlForAd(ad),
        metaAdId: ad?.metaAdId ?? null,
      },
      advertiserFallback: readEventAdvertiser(event),
      captureReasonCode: readRecordString(event.metadata, "captureReasonCode"),
      proofCapture,
    });
  });

  const linkedAds = rows.filter((row) => row._meta.hasLinkedAd).length;
  const eventTypes = summarizeDistinct(
		eligibleEvents.map((event) => formatWatchEventTypeLabel(event.eventType)),
  );

  return {
    kind: "report",
    reportId: createReportId("watchlist", input.watchlist.id),
    resourceType: "watchlist",
    resourceId: input.watchlist.id,
    title: input.watchlist.name,
    subtitle: `${input.watchlist.targetType.replaceAll("_", " ")} · ${input.watchlist.targetLabel}`,
    summary: `${rows.length} verified-evidence watch event${rows.length === 1 ? "" : "s"} with linked ad context where available.`,
    generatedAt,
    stats: [
      { label: "Events", value: String(rows.length) },
      { label: "Linked ads", value: String(linkedAds) },
      { label: "Event types", value: eventTypes },
      { label: "Excluded", value: String(sourceCoverage.excluded) },
    ],
    insightDepth: buildWatchlistInsightDepth(eligibleEvents),
    sourceCoverage,
		...(input.aiWeeklySummary ? { aiWeeklySummary: input.aiWeeklySummary } : {}),
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
    captureReasonCode?: string | null;
    proofCapture?: ProofCaptureRecord | null;
  },
) {
  const proofCapture = options.proofCapture ?? null;
  const creativeText = resolveCreativeText(ad);
  const adLandingPageHeadline =
    presentString(ad?.landingPage?.rawHeadline) ??
    findAnalysisFieldValue(ad, "landing_page_headline_summary");
  const landingPageHeadline =
    proofCapture
      ? readProofString(proofCapture, "rawHeadline", "headline")
      : adLandingPageHeadline;
  const landingPageUrl =
    proofCapture
      ? readProofString(proofCapture, "canonicalUrl")
      : ad?.landingPage?.canonicalUrl ??
        ad?.landingPageUrl ??
        null;
  const proofCaptureMethod = readProofCaptureMethod(proofCapture);
  const proofCapturedAt =
    proofCapture?.status === "succeeded"
      ? proofCapture.succeededAt ?? proofCapture.attemptedAt
      : null;
	const landingPageCaptureMethod = proofCapture
		? proofCaptureMethod
		: ad?.landingPage?.captureMethod ?? null;
	const landingPageCaptured = Boolean(landingPageCaptureMethod);
	// Missing fields stay null so the report view can omit them entirely.
	// Client-facing reports must never render "unavailable" placeholder prose.
  const reportRow = {
    id,
		advertiser: ad ? ad.advertiser : options.advertiserFallback ?? null,
		previewHeadline: ad?.previewHeadline ?? options.event?.title ?? null,
		offer: presentString(ad?.offer),
		cta: presentString(ad?.cta),
    formatLabel: ad?.format ?? "unknown",
		languageLabel: presentString(ad?.languageLabel),
    // Prefer the actual captured creative image; the snapshot URL is only a
    // legacy fallback (it may point at an Ad Library page rather than media).
    previewImageUrl: ad?.creativeImageUrl ?? ad?.adSnapshotUrl ?? null,
		creativeText: presentString(creativeText),
		translatedText: presentString(findAnalysisFieldValue(ad, "translated_text")),
    captureReasonCode: resolveCaptureReasonCode(
      ad,
      proofCapture,
      options.captureReasonCode,
    ),
    landingPage: {
			url: landingPageUrl,
			headline: presentString(landingPageHeadline),
			captureLabel: landingPageCaptured
				? formatCaptureMethodLabel(landingPageCaptureMethod)
				: null,
      capturedAt:
        proofCapture
          ? proofCapturedAt
          : ad?.landingPage?.capturedAt ?? null,
			signals: buildLandingPageSignals(ad, proofCapture),
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

function presentString(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

// Only known landing-page signals make it into the report. Undetected
// signals are omitted rather than rendered as "Not detected" filler.
function buildLandingPageSignals(
  ad: AdRecord | null,
  proofCapture: ProofCaptureRecord | null = null,
): ReportField[] {
	const ctaText = presentString(
    proofCapture
      ? readProofString(proofCapture, "ctaText", "cta")
      : ad?.landingPage?.ctaText,
  );
	const priceText = presentString(
    proofCapture
      ? readProofString(proofCapture, "priceText", "offer")
      : ad?.landingPage?.priceText,
  );
	const formPresent =
    proofCapture
      ? readProofBoolean(proofCapture, "formPresent")
      : ad?.landingPage?.formPresent;

	return [
		...(ctaText ? [{ label: "CTA", value: ctaText }] : []),
		...(priceText ? [{ label: "Price", value: priceText }] : []),
		...(typeof formPresent === "boolean"
			? [{ label: "Form present", value: formatLandingPageFormValue(formPresent) }]
			: []),
	];
}

function readProofString(
  proofCapture: ProofCaptureRecord | null,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = proofCapture?.extractedFields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readProofBoolean(proofCapture: ProofCaptureRecord | null, key: string) {
  const value = proofCapture?.extractedFields[key];
  return typeof value === "boolean" ? value : null;
}

function readProofCaptureMethod(proofCapture: ProofCaptureRecord | null) {
  if (proofCapture?.status !== "succeeded") return null;
  const captureMethod = proofCapture?.captureMetadata.captureMethod;
  if (captureMethod === "landing_page_fetch" || captureMethod === "browser_render") {
    return captureMethod;
  }
  if (typeof proofCapture?.captureMetadata.renderProvider === "string") {
    return "browser_render" as const;
  }
  return null;
}

function resolveCreativeText(ad: AdRecord | null) {
  return ad?.creativeText?.trim() || findAnalysisFieldValue(ad, "ocr_text");
}

function resolveCaptureReasonCode(
  ad: AdRecord | null,
  proofCapture: ProofCaptureRecord | null,
  eventReasonCode: string | null | undefined,
) {
  const landingReason = readRecordString(
    ad?.landingPage?.metadata,
    "unreadableReasonCode",
  );
  const creativeReason = readRecordString(
    ad?.creativeTextMetadata,
    "unreadableReasonCode",
  );
  const missingCreativeReason =
    creativeReason && !presentString(resolveCreativeText(ad))
      ? creativeReason
      : null;
  const eventReason = presentString(eventReasonCode);

  if (proofCapture?.status === "failed") {
    return (
      proofCapture.failureCode ??
      readRecordString(proofCapture.captureMetadata, "unreadableReasonCode") ??
      missingCreativeReason ??
      eventReason ??
      "landing_capture_failed"
    );
  }
  if (proofCapture?.status === "succeeded") {
    return (
      readRecordString(
        proofCapture.captureMetadata,
        "unreadableReasonCode",
      ) ??
      missingCreativeReason ??
      eventReason
    );
  }

  if (landingReason) return landingReason;
  if (missingCreativeReason) return missingCreativeReason;
  return eventReason;
}

function readRecordString(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function sourceUrlForAd(ad: AdRecord | null) {
  return ad ? proofLinkForAd(ad) ?? ad.landingPage?.canonicalUrl ?? ad.landingPageUrl : null;
}

function stripInternalMeta(
  row: ReturnType<typeof buildReportRow>,
): ReportRow {
  const { _meta, ...reportRow } = row;
  return reportRow;
}
