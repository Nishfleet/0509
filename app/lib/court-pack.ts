/**
 * Court Pack — isomorphic types and pure helpers.
 *
 * This module owns the durable shape of an Agency Court Pack slice:
 * numbered evidence plates from already-approved client-room reports,
 * an explicit exclusion list for stale / failed / unloadable reports,
 * and coverage counts that describe only what the assembly saw.
 *
 * No server-only imports live here. The builder does the I/O; this file
 * owns the data contract, the approval-metadata reader (the real persisted
 * `notes.reportApprovals` shape: metadata keyed by report id, never full
 * report documents), and the deterministic numbering + coverage math.
 */

import type {
  ReportDocument,
  ReportEventSummary,
  ReportField,
  ReportResourceType,
} from "~/lib/report";
import { REPORT_APPROVAL_MAX_AGE_MS } from "~/lib/report-approval";

export const COURT_PACK_EXCLUSION_REASON_CODES = {
  /** The room has no saved approval metadata for this report. */
  noApproval: "no_approval",
  /** A saved approval entry exists but is malformed or violates the approval window. */
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
  /**
   * Classified from the report id via `parseReportId` (watchlist|collection).
   * `null` only for a report id that cannot be parsed; such refs are already
   * filtered out of the room view by the route, so this is defensive only.
   */
  resourceType: ReportResourceType | null;
  resourceLabel: string | null;
  reasonCode: CourtPackExclusionReasonCode;
  reason: string;
}

/**
 * One approved, successfully-revalidated report included in the pack.
 *
 * The view renders the durable section/row/proof content from `report`; the
 * builder keeps the section faithful to the `ReportDocument` that passed the
 * approval + revalidation gates. `reviewedAt` / `approvalExpiresAt` /
 * `evidenceFingerprint` come verbatim from the saved approval metadata.
 */
export interface CourtPackReportSection {
  reportId: string;
  resourceType: ReportResourceType;
  title: string;
  subtitle: string;
  summary: string;
  generatedAt: string;
  reviewedAt: string;
  approvalExpiresAt: string;
  evidenceFingerprint: string;
  report: ReportDocument;
}

/**
 * One numbered evidence plate shown in the pack.
 *
 * `plateNumber` is computed by `numberCourtPackPlates(...)` and is stable
 * for unchanged input. It is always gap-free (1..N over included sections).
 * First-row summary fields are `null` when the row does not carry them —
 * no fallback labels are invented.
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
  proofStatusLabel: string | null;
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
  /** Report refs with a currently-valid saved approval (pre-revalidation). */
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
   * `true` when no report made it into the pack — i.e. the room has zero
   * approved, currently-revalidated reports. The view renders the honest
   * approval-oriented empty state; exclusions are still listed separately.
   */
  hasNothingToPack: boolean;
}

/**
 * The real persisted approval shape inside `client_room.notes_json`:
 * `reportApprovals` maps a report id (the `report` resource ref's
 * `resourceId`, e.g. `watchlist:w-1`) to approval metadata only. The route's
 * approve action stores exactly these three fields (see the `approve-client-
 * room` intent in `app/routes/app.clients.tsx`); the full document is never
 * persisted in room notes.
 */
export interface CourtPackApprovalMetadata {
  evidenceFingerprint: string;
  reviewedAt: string;
  approvalExpiresAt: string;
}

export type CourtPackApprovalEvaluation =
  | { ok: true; metadata: CourtPackApprovalMetadata }
  | {
      ok: false;
      reasonCode: "approval_invalid" | "approval_expired";
      reason: string;
    };

/**
 * Read the raw `reportApprovals` record from room notes. Missing or
 * non-record values yield `{}` — never a throw.
 */
export function readCourtPackApprovalEntries(
  notes: Record<string, unknown>,
): Record<string, unknown> {
  const raw = notes.reportApprovals;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/**
 * Validate one saved approval entry against the same window rules the route
 * uses (`readRoomApprovals` in `app/routes/app.clients.tsx`, built on
 * `REPORT_APPROVAL_MAX_AGE_MS`). Returns the validated metadata, or a
 * distinguishable `approval_invalid` / `approval_expired` failure.
 */
export function evaluateCourtPackApprovalMetadata(
  value: unknown,
  now = Date.now(),
): CourtPackApprovalEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      reasonCode: "approval_invalid",
      reason: "The saved approval is not a valid approval record.",
    };
  }

  const candidate = value as Record<string, unknown>;
  const evidenceFingerprint =
    typeof candidate.evidenceFingerprint === "string" &&
    candidate.evidenceFingerprint.length > 0
      ? candidate.evidenceFingerprint
      : null;
  const reviewedAt = canonicalIsoDate(candidate.reviewedAt);
  const approvalExpiresAt = canonicalIsoDate(candidate.approvalExpiresAt);
  if (!evidenceFingerprint || !reviewedAt || !approvalExpiresAt) {
    return {
      ok: false,
      reasonCode: "approval_invalid",
      reason: "The saved approval is incomplete or malformed. Review the current evidence again.",
    };
  }

  const reviewedAtMs = Date.parse(reviewedAt);
  const approvalExpiresAtMs = Date.parse(approvalExpiresAt);
  if (reviewedAtMs > now) {
    return {
      ok: false,
      reasonCode: "approval_invalid",
      reason: "The saved approval timestamp is in the future. Review the current evidence again.",
    };
  }
  if (approvalExpiresAtMs <= now) {
    return {
      ok: false,
      reasonCode: "approval_expired",
      reason: "This report approval has expired. Review the current evidence again.",
    };
  }
  if (
    approvalExpiresAtMs <= reviewedAtMs ||
    approvalExpiresAtMs > reviewedAtMs + REPORT_APPROVAL_MAX_AGE_MS
  ) {
    return {
      ok: false,
      reasonCode: "approval_invalid",
      reason: "The saved approval window is invalid. Review the current evidence again.",
    };
  }

  return {
    ok: true,
    metadata: { evidenceFingerprint, reviewedAt, approvalExpiresAt },
  };
}

function canonicalIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function safeTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function plateSortKey(reportId: string): string {
  // Report ids carry the canonical `${type}:${id}` form, so a plain
  // lexicographic compare keeps watchlist and collection reports in a
  // deterministic, stable order across reloads.
  return reportId;
}

/**
 * Build the numbered, gap-free plate list from approved report sections.
 *
 * Determinism rules:
 * - Sections are sorted by `reportId` (stable `.sort`) so ordering does not
 *   depend on ref order and stays identical across reloads for unchanged input.
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
  for (const section of sorted) {
    const plate = firstPlateForSection(section);
    if (!plate) {
      continue;
    }
    plates.push({
      ...plate,
      plateNumber: plates.length + 1,
    });
  }

  return plates;
}

function firstPlateForSection(
  section: CourtPackReportSection,
): Omit<CourtPackPlate, "plateNumber"> | null {
  const firstRow = section.report.rows[0] ?? null;
  if (!firstRow) {
    // A section that passed the readiness gate always has rows; this guard
    // keeps the plate list gap-free even for a defensive null.
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
      safeTrimmedString(firstRow.landingPage.capturedAt) ??
      safeTrimmedString(firstRow.event?.createdAt ?? null),
    proofStatusLabel: firstRow.event?.proofStatusLabel ?? null,
    sourceUrl: firstRow.event?.sourceUrl ?? null,
    event: firstRow.event ?? null,
    analysisFields: firstRow.analysisFields ?? [],
    captureLabel: safeTrimmedString(firstRow.landingPage.captureLabel),
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
