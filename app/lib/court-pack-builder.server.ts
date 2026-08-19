/**
 * Court Pack builder — server-only assembly.
 *
 * Reads the real persisted client-room approval shape
 * (`notes.reportApprovals` metadata keyed by report id, written by the
 * `approve-client-room` intent in `app/routes/app.clients.tsx`), revalidates
 * each approved report against the current owned document using the existing
 * readiness + fingerprint helpers, and produces one `CourtPack` value.
 *
 * Honesty rules:
 * - Only reports with a currently-valid approval AND a current readiness pass
 *   AND a matching evidence fingerprint become sections/plates.
 * - Every other report ref lands in `excluded` with a distinguishable reason
 *   code — never silently dropped, never upgraded.
 * - Branding is optional: any failure to load it renders as absent, never as
 *   placeholder prose.
 */

import type { AppEnv } from "~/lib/env.server";
import type { ClientRoomRecord } from "~/lib/types";
import type { OwnedReportDataSource } from "~/lib/report-loader.server";
import { loadOwnedReportDocument } from "~/lib/report-loader.server";
import {
  evaluateReportReadiness,
  reportEvidenceFingerprint,
} from "~/lib/report-approval";
import { getWorkspaceBranding } from "~/lib/data/workspace-branding.server";
import { parseReportId, type ReportDocument } from "~/lib/report";
import {
  COURT_PACK_EXCLUSION_REASON_CODES,
  evaluateCourtPackApprovalMetadata,
  numberCourtPackPlates,
  readCourtPackApprovalEntries,
  summarizeCourtPackCoverage,
  type CourtPack,
  type CourtPackBranding,
  type CourtPackExclusion,
  type CourtPackReportSection,
} from "~/lib/court-pack";

export async function buildCourtPack(
  env: AppEnv,
  userId: string,
  room: ClientRoomRecord,
  data: OwnedReportDataSource,
): Promise<CourtPack> {
  const generatedAt = new Date().toISOString();
  const reportRefs = room.resourceRefs.filter(
    (ref) => ref.resourceType === "report",
  );
  const rawApprovals = readCourtPackApprovalEntries(room.notes);

  const excluded: CourtPackExclusion[] = [];
  const sections: CourtPackReportSection[] = [];
  let validApprovals = 0;

  for (const ref of reportRefs) {
    const reportId = ref.resourceId;
    const resourceLabel =
      typeof ref.label === "string" && ref.label.trim().length > 0
        ? ref.label.trim()
        : null;
    const classifiedType = parseReportId(reportId)?.resourceType ?? null;

    const rawEntry = rawApprovals[reportId];
    if (rawEntry === undefined) {
      excluded.push({
        reportId,
        resourceType: classifiedType,
        resourceLabel,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.noApproval,
        reason: "This report has not been approved for client review yet.",
      });
      continue;
    }

    const evaluation = evaluateCourtPackApprovalMetadata(rawEntry);
    if (!evaluation.ok) {
      excluded.push({
        reportId,
        resourceType: classifiedType,
        resourceLabel,
        reasonCode:
          evaluation.reasonCode === "approval_expired"
            ? COURT_PACK_EXCLUSION_REASON_CODES.approvalExpired
            : COURT_PACK_EXCLUSION_REASON_CODES.approvalInvalid,
        reason: evaluation.reason,
      });
      continue;
    }
    validApprovals += 1;
    const metadata = evaluation.metadata;

    let report: ReportDocument | null = null;
    try {
      report = await loadOwnedReportDocument(env, userId, reportId, data, {
        requireActiveWatchlist: true,
        verifyReportIdentity: true,
      });
    } catch {
      report = null;
    }
    if (!report) {
      excluded.push({
        reportId,
        resourceType: classifiedType,
        resourceLabel,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.loadFailed,
        reason: "The current report could not be loaded for revalidation.",
      });
      continue;
    }

    const readiness = evaluateReportReadiness(report);
    if (!readiness.ok) {
      excluded.push({
        reportId,
        resourceType: report.resourceType,
        resourceLabel,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.readinessFailed,
        reason: readiness.reason,
      });
      continue;
    }

    if (reportEvidenceFingerprint(report) !== metadata.evidenceFingerprint) {
      excluded.push({
        reportId,
        resourceType: report.resourceType,
        resourceLabel,
        reasonCode: COURT_PACK_EXCLUSION_REASON_CODES.fingerprintMismatch,
        reason: "The report changed after approval and needs review again.",
      });
      continue;
    }

    sections.push({
      reportId,
      resourceType: report.resourceType,
      title: report.title,
      subtitle: report.subtitle,
      summary: report.summary,
      generatedAt: report.generatedAt,
      reviewedAt: metadata.reviewedAt,
      approvalExpiresAt: metadata.approvalExpiresAt,
      evidenceFingerprint: metadata.evidenceFingerprint,
      report,
    });
  }

  const branding = await loadBranding(env, userId);
  const plates = numberCourtPackPlates(sections);

  return {
    roomId: room.id,
    roomName: room.name,
    clientLabel: room.clientLabel ?? null,
    preparedBy: branding?.brandName ?? null,
    branding,
    generatedAt,
    sections,
    plates,
    excluded,
    coverage: summarizeCourtPackCoverage({
      approvedReports: validApprovals,
      includedSections: sections,
      excluded,
      plates,
    }),
    hasNothingToPack: sections.length === 0,
  };
}

async function loadBranding(
  env: AppEnv,
  userId: string,
): Promise<CourtPackBranding | null> {
  try {
    const found = await getWorkspaceBranding(env, userId);
    return found.brandName || found.brandLogo || found.brandWebsite
      ? found
      : null;
  } catch {
    // Branding is optional by contract: an unavailable branding lookup is
    // rendered as an absent brand block, never as placeholder prose.
    return null;
  }
}
