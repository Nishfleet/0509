/**
 * Court Pack — isomorphic types and pure helpers.
 *
 * This module owns the durable shape of an Agency Court Pack slice:
 * numbered evidence plates from already-approved client-room reports,
 * an explicit exclusion list for stale / failed / unloadable reports,
 * and coverage counts that describe only what the assembly saw.
 *
 * No server-only imports live here. The builder does the I/O; this file
 * owns the data contract and the deterministic numbering + coverage math.
 */

import type {
  ReportDocument,
  ReportEventSummary,
  ReportField,
  ReportResourceType,
} from "~/lib/report";

export const COURT_PACK_EXCLUSION_REASON_CODES = {
  /** The room has no saved approval snapshot for this report. */
  noApproval: "no_approval",
  /** A saved approval snapshot exists but no longer satisfies the current approval window. */
  approvalInvalid: "approval_invalid",
  /** The saved approval window had elapsed before the pack was assembled. */
  approvalExpired: "approval_expired",
  /** The current report's evidence fingerprint does not match the saved approval fingerprint. */
  fingerprintMismatch: "fingerprint_mismatch",
  /** The current report failed the readiness gate (missing rows, freshness, or unverified events). */
  readinessFailed: "readiness_failed",
  /** loadOwnedReportDocument threw or returned null for this report. */
  loadFailed: "load_failed",
} as const;

export type CourtPackExclusionReasonCode =
  (typeof COURT_PACK_EXCLUSION_REASON_CODES)[keyof typeof COURT_PACK_EXCLUSION_REASON_CODES];

export interface CourtPackExclusion {
  reportId: string;
  resourceType: ReportResourceType;
  resourceLabel: string | null;
  reasonCode: CourtPackExclusionReasonCode;
  reason: string;
}

/**
 * One approved, successfully-revalidated report included in the pack.
 *
 * The view is responsible for rendering the rows / events; the builder is
 * responsible for keeping this section faithful to the ReportDocument that
 * passed the approval + revalidation gates. We pass the raw ReportDocument
 * shape through so the view can reuse durable report section data, proof
 * labels, and proof trails without inventing new proof semantics.
 */
export interface CourtPackReportSection {
  reportId: string;
  resourceType: ReportResourceType;
  title: string;
  subtitle: string;
  summary: string;
  generatedAt: string;
  reviewedAt: string | null;
  approvalExpiresAt: string | null;
  evidenceFingerprint: string | null;
  report: ReportDocument;
}

/**
 * One numbered evidence plate shown in the pack.
 *
 * `plateNumber` is computed by `numberCourtPackPlates(...)` and is stable
 * for unchanged input. It is always gap-free (1..N over included sections).
 */
export interface CourtPackPlate {
  plateNumber: number;
  reportId: string;
  resourceType: ReportResourceType;
  resourceLabel: string | null;
  title: string;
  advertiser: string | null;
  headline: string | null;
  capturedAt: string | null;
  proofStatusLabel: string;
  sourceUrl: string | null;
  event: ReportEventSummary | null;
  analysisFields: ReportField[];
  captureLabel: string | null;
}

/**
 * Counts of what was assembled. No invented percentages, no derived
 * coverage claims — only the integer counts the builder observed.
 */
export interface CourtPackCoverage {
  approvedReports: number;
  includedSections: number;
  excluded: number;
  excludedByReason: Record<CourtPackExclusionReasonCode, number>;
  plates: number;
}

export interface CourtPackBranding {
  brandName: string | null;
  brandWebsite: string | null;
  brandLogo: string | null;
}

export interface CourtPack {
  roomId: string;
  roomName: string;
  clientLabel: string | null;
  preparedBy: string | null;
  branding: CourtPackBranding | null;
  generatedAt: string;
  sections: CourtPackReportSection[];
  plates: CourtPackPlate[];
  excluded: CourtPackExclusion[];
  coverage: CourtPackCoverage;
  /**
   * `true` only when the room has zero approved snapshots AND zero
   * excluded reports — i.e. the room simply has nothing to pack.
   * Used by the view to render an honest empty state rather than a
   * fabricated pack.
   */
  hasNothingToPack: boolean;
}

function safeTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function plateSortKey(reportId: string): string {
  // Report id already carries the canonical `${type}:${id}` form, so a
  // plain lexicographic compare keeps watchlist and collection reports in a
  // deterministic, stable order across reloads.
  return reportId;
}

/**
 * Build the numbered, gap-free plate list from approved report sections.
 *
 * Determinism rules:
 * - Sections are sorted by `reportId` so watchlist and collection reports
 *   keep stable ordering across reloads for unchanged input.
 * - Plate numbers are gap-free 1..N over the included sections only.
 * - Excluded reports never receive a plate number — they are never plates.
 */
export function numberCourtPackPlates(
  sections: CourtPackReportSection[],
): CourtPackPlate[] {
  const sorted = [...sections].sort((left, right) =>
    plateSortKey(left.reportId).localeCompare(plateSortKey(right.reportId)),
  );

  const plates: CourtPackPlate[] = [];
  sorted.forEach((section) => {
    const plate = firstPlateForSection(section);
    if (!plate) {
      return;
    }
    plates.push({
      ...plate,
      plateNumber: plates.length + 1,
    });
  });

  return plates;
}

function firstPlateForSection(
  section: CourtPackReportSection,
): Omit<CourtPackPlate, "plateNumber"> | null {
  const firstRow = section.report.rows[0] ?? null;
  if (!firstRow) {
    // A report can be approved with no rows if all rows were excluded by the
    // source coverage filter — the section still belongs in the pack, just
    // with no plate.
    return null;
  }
  return {
    reportId: section.reportId,
    resourceType: section.resourceType,
    resourceLabel: section.title,
    title: section.title,
    advertiser: safeTrimmedString(firstRow.advertiser),
    headline: safeTrimmedString(
      firstRow.event?.title ?? firstRow.previewHeadline,
    ),
    capturedAt:
      safeTrimmedString(firstRow.landingPage?.capturedAt) ??
      safeTrimmedString(firstRow.event?.createdAt),
    proofStatusLabel:
      firstRow.event?.proofStatusLabel ?? "Saved evidence",
    sourceUrl: firstRow.event?.sourceUrl ?? null,
    event: firstRow.event ?? null,
    analysisFields: firstRow.analysisFields ?? [],
    captureLabel: safeTrimmedString(firstRow.landingPage?.captureLabel),
  };
}

/**
 * Summarize coverage counts. No percentages, no derived ratios.
 */
export function summarizeCourtPackCoverage(input: {
  approvedReports: number;
  includedSections: CourtPackReportSection[];
  excluded: CourtPackExclusion[];
  plates: CourtPackPlate[];
}): CourtPackCoverage {
  const excludedByReason: Record<CourtPackExclusionReasonCode, number> = {
    no_approval: 0,
    approval_invalid: 0,
    approval_expired: 0,
    fingerprint_mismatch: 0,
    readiness_failed: 0,
    load_failed: 0,
  };
  for (const exclusion of input.excluded) {
    excludedByReason[exclusion.reasonCode] += 1;
  }
  return {
    approvedReports: input.approvedReports,
    includedSections: input.includedSections.length,
    excluded: input.excluded.length,
    excludedByReason,
    plates: input.plates.length,
  };
}
