import type { AppEnv } from "~/lib/env.server";
import type { ClientRoomRecord } from "~/lib/types";
import type { OwnedReportDataSource } from "~/lib/report-loader.server";
import { loadOwnedReportDocument } from "~/lib/report-loader.server";
import { evaluateApprovedReportSnapshot, reportEvidenceFingerprint } from "~/lib/report-approval";
import { getWorkspaceBranding } from "~/lib/data/workspace-branding.server";
import { numberCourtPackPlates, summarizeCourtPackCoverage, COURT_PACK_EXCLUSION_REASON_CODES, type CourtPack, type CourtPackExclusion, type CourtPackReportSection } from "~/lib/court-pack";
import type { ReportDocument, ReportResourceType } from "~/lib/report";

function reportLabel(ref: { label?: string | null; resourceId: string }) { return ref.label?.trim() || ref.resourceId; }
function reasonFor(code: string) {
  if (code === "approval_expired") return COURT_PACK_EXCLUSION_REASON_CODES.approvalExpired;
  if (code === "fingerprint_mismatch") return COURT_PACK_EXCLUSION_REASON_CODES.fingerprintMismatch;
  if (code === "no_current_evidence" || code === "evidence_unverified") return COURT_PACK_EXCLUSION_REASON_CODES.readinessFailed;
  return COURT_PACK_EXCLUSION_REASON_CODES.approvalInvalid;
}

export async function buildCourtPack(env: AppEnv, userId: string, room: ClientRoomRecord, data: OwnedReportDataSource): Promise<CourtPack> {
  const generatedAt = new Date().toISOString();
  const refs = room.resourceRefs.filter((ref) => ref.resourceType === "report");
  const approvals = room.notes.reportApprovals && typeof room.notes.reportApprovals === "object" ? room.notes.reportApprovals as Record<string, unknown> : {};
  const excluded: CourtPackExclusion[] = [];
  const sections: CourtPackReportSection[] = [];
  for (const ref of refs) {
    const snapshot = approvals[ref.resourceId];
    if (!snapshot) { excluded.push({ reportId: ref.resourceId, resourceType: "watchlist", resourceLabel: reportLabel(ref), reasonCode: "no_approval", reason: "This report has not been approved yet." }); continue; }
    const approval = evaluateApprovedReportSnapshot(snapshot);
    if (!approval.ok) { excluded.push({ reportId: ref.resourceId, resourceType: (snapshot as any).resourceType ?? "watchlist", resourceLabel: reportLabel(ref), reasonCode: reasonFor(approval.reasonCode), reason: approval.reason }); continue; }
    const parsed = snapshot as ReportDocument & { reviewedAt: string; approvalExpiresAt: string; evidenceFingerprint: string };
    let report: ReportDocument | null = null;
    try { report = await loadOwnedReportDocument(env, userId, ref.resourceId, data, { requireActiveWatchlist: true, verifyReportIdentity: true }); } catch { report = null; }
    if (!report) { excluded.push({ reportId: ref.resourceId, resourceType: parsed.resourceType, resourceLabel: reportLabel(ref), reasonCode: "load_failed", reason: "The current report could not be loaded for revalidation." }); continue; }
    if (reportEvidenceFingerprint(report) !== parsed.evidenceFingerprint) { excluded.push({ reportId: ref.resourceId, resourceType: parsed.resourceType, resourceLabel: reportLabel(ref), reasonCode: "fingerprint_mismatch", reason: "The report changed after approval and needs review again." }); continue; }
    sections.push({ reportId: ref.resourceId, resourceType: report.resourceType, title: report.title, subtitle: report.subtitle, summary: report.summary, generatedAt: report.generatedAt, reviewedAt: parsed.reviewedAt, approvalExpiresAt: parsed.approvalExpiresAt, evidenceFingerprint: parsed.evidenceFingerprint, report });
  }
  const plates = numberCourtPackPlates(sections);
  const branding = await getWorkspaceBranding(env, userId);
  return { roomId: room.id, roomName: room.name, clientLabel: room.clientLabel, preparedBy: branding.brandName, branding: branding.brandName || branding.brandLogo || branding.brandWebsite ? branding : null, generatedAt, sections, plates, excluded, coverage: summarizeCourtPackCoverage({ approvedReports: Object.keys(approvals).length, includedSections: sections, excluded, plates }), hasNothingToPack: Object.keys(approvals).length === 0 && excluded.length === 0 };
}
