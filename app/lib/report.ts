import type { InsightDepthSummary } from "~/lib/insight-depth";

export const REPORT_RESOURCE_TYPES = ["collection", "watchlist"] as const;

export type ReportResourceType = (typeof REPORT_RESOURCE_TYPES)[number];

export interface ReportStat {
  label: string;
  value: string;
}

export interface ReportField {
  label: string;
  value: string;
  sourceLabel?: string;
}

export interface ReportLandingPage {
	url: string | null;
	headline: string | null;
	captureLabel: string | null;
  capturedAt: string | null;
  signals: ReportField[];
}

export interface ReportEventSummary {
  typeLabel: string;
  title: string;
  summary: string;
  createdAt: string;
  priorityScore: number | null;
  priorityBand: string;
  recommendedAction: string;
  proofTrail: string;
  proofStatusLabel: string;
  sourceTypeLabel: string;
  sourceUrl: string | null;
  metaAdId: string | null;
}

export interface ReportSourceCoverage {
  totalInput: number;
  included: number;
  excluded: number;
  note: string;
  proofMix: {
    verifiedProof: number;
    scanSpotted: number;
    needsReview: number;
    proofPending: number;
    proofFailed: number;
    excluded: number;
    unknown: number;
  };
  excludedCounts: Record<string, number>;
}

// Missing report fields are null, never placeholder prose. The report view
// omits absent fields entirely — a sparse report shows only what is known.
export interface ReportRow {
  id: string;
	advertiser: string | null;
	previewHeadline: string | null;
	offer: string | null;
	cta: string | null;
  formatLabel: string;
	languageLabel: string | null;
  previewImageUrl: string | null;
	creativeText: string | null;
	translatedText: string | null;
  /** Stable server-side reason for missing capture text/signals. */
  captureReasonCode?: string | null;
  landingPage: ReportLandingPage;
  analysisFields: ReportField[];
  tags: string[];
  note: string | null;
  event?: ReportEventSummary;
}

export interface ReportAiWeeklySummary {
	paragraph: string;
	generatedAt: string | null;
	periodEnd: string;
}

export interface ReportDocument {
  kind: "report";
  reportId: string;
  resourceType: ReportResourceType;
  resourceId: string;
  title: string;
  subtitle: string;
  summary: string;
  generatedAt: string;
  stats: ReportStat[];
  insightDepth: InsightDepthSummary;
  sourceCoverage?: ReportSourceCoverage;
	// AI weekly summary sourced from the latest stored digest run — never a
	// fresh AI call at report time. Absent renders nothing.
	aiWeeklySummary?: ReportAiWeeklySummary;
  rows: ReportRow[];
}

export function createReportId(resourceType: ReportResourceType, resourceId: string) {
  return `${resourceType}:${resourceId}`;
}

export function parseReportId(reportId: string) {
  const [resourceType, ...rest] = reportId.split(":");
  const resourceId = rest.join(":").trim();

  if (
    !REPORT_RESOURCE_TYPES.includes(resourceType as ReportResourceType) ||
    !resourceId
  ) {
    return null;
  }

  return {
    resourceType: resourceType as ReportResourceType,
    resourceId,
  };
}

export function isReportDocument(value: unknown): value is ReportDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.kind === "report" &&
    typeof candidate.reportId === "string" &&
    typeof candidate.resourceId === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.rows)
  );
}

/**
 * API v1 and MCP exposed report fields as strings before sparse reports began
 * using null internally. Keep the truthful nullable document for UI, storage,
 * and public snapshots, but adapt only the transport response so existing
 * clients do not receive a mutative contract change.
 */
export function adaptLegacyReportTransportResult<T>(value: T): T {
	if (!isPlainRecord(value)) {
		return value;
	}
	const direct = adaptLegacyReportRecord(value);
	const nested = isPlainRecord(direct.result)
		? adaptLegacyReportRecord(direct.result)
		: null;
	return (nested && nested !== direct.result
		? { ...direct, result: nested }
		: direct) as T;
}

function adaptLegacyReportRecord(value: Record<string, unknown>) {
	if (!isReportDocument(value.report)) {
		return value;
	}

	return {
		...value,
		report: {
			...value.report,
			rows: value.report.rows.map((row) => ({
				...row,
				advertiser: row.advertiser ?? "Ad context unavailable",
				previewHeadline: row.previewHeadline ?? "Preview unavailable",
				offer: row.offer ?? "Offer unavailable",
				cta: row.cta ?? "CTA unavailable",
				languageLabel: row.languageLabel ?? "Language unavailable",
				creativeText: row.creativeText ?? "Creative text unavailable",
				translatedText: row.translatedText ?? "Translation unavailable",
				landingPage: {
					...row.landingPage,
					url: row.landingPage.url ?? "Landing page unavailable",
					headline:
						row.landingPage.headline ?? "Landing page headline unavailable",
					captureLabel: row.landingPage.captureLabel ?? "Not checked yet",
				},
			})),
		},
	};
}

/**
 * Canonical public-share renderability check for immutable report snapshots.
 * Collection snapshots can be safely normalized from sparse row objects.
 * Watchlist snapshots additionally require the verified-proof provenance the
 * public share view promises before any row can be rendered.
 */
export function isRenderableReportSnapshot(value: unknown): value is ReportDocument {
	if (!isReportDocument(value)) {
		return false;
	}

	const candidate = value as unknown as Record<string, unknown>;
	if (
		candidate.resourceType !== "collection" &&
		candidate.resourceType !== "watchlist"
	) {
		return false;
	}

	if (candidate.resourceType === "collection") {
		return true;
	}

	if (!isPlainRecord(candidate.sourceCoverage)) {
		return false;
	}

	return (candidate.rows as unknown[])
		.filter(isPlainRecord)
		.every(hasVerifiedReportRowProof);
}

function hasVerifiedReportRowProof(row: Record<string, unknown>) {
	if (!isPlainRecord(row.event)) {
		return false;
	}

	const proofStatusLabel = readTrimmedString(row.event.proofStatusLabel)?.toLowerCase();
	const sourceTypeLabel = readTrimmedString(row.event.sourceTypeLabel)?.toLowerCase();
	return (
		(proofStatusLabel === "verified evidence" || proofStatusLabel === "verified proof") &&
		(sourceTypeLabel === "saved evidence" || sourceTypeLabel === "proof snapshot")
	);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readTrimmedString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
