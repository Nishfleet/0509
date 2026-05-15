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
  url: string;
  headline: string;
  captureLabel: string;
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
}

export interface ReportRow {
  id: string;
  advertiser: string;
  previewHeadline: string;
  offer: string;
  cta: string;
  formatLabel: string;
  languageLabel: string;
  previewImageUrl: string | null;
  creativeText: string;
  translatedText: string;
  landingPage: ReportLandingPage;
  analysisFields: ReportField[];
  tags: string[];
  note: string | null;
  event?: ReportEventSummary;
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
