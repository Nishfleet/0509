import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isReportDocument, type ReportDocument } from "~/lib/report";

export const REPORT_REVIEW_STATE = "approved" as const;
export const REPORT_EVIDENCE_STATE = "current" as const;
export const REPORT_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const REPORT_APPROVAL_REASON_CODES = {
  noCurrentEvidence: "no_current_evidence",
  freshnessUnverified: "freshness_unverified",
  evidenceUnverified: "evidence_unverified",
  invalidResource: "invalid_resource",
  invalidApproval: "invalid_approval",
  approvalInFuture: "approval_in_future",
  approvalExpired: "approval_expired",
  approvalWindowInvalid: "approval_window_invalid",
  fingerprintMismatch: "fingerprint_mismatch",
} as const;

export type ReportApprovalReasonCode =
  (typeof REPORT_APPROVAL_REASON_CODES)[keyof typeof REPORT_APPROVAL_REASON_CODES];

type ReportApprovalFailure = {
  ok: false;
  reasonCode: ReportApprovalReasonCode;
  reason: string;
};

export type ApprovedReportMetadata = {
  reviewState: typeof REPORT_REVIEW_STATE;
  evidenceState: typeof REPORT_EVIDENCE_STATE;
  reviewedAt: string;
  approvalExpiresAt: string;
  evidenceFingerprint: string;
};

export function evaluateReportReadiness(report: ReportDocument) {
  if (
    (report.resourceType !== "collection" &&
      report.resourceType !== "watchlist") ||
    typeof report.reportId !== "string" ||
    report.reportId.trim().length === 0 ||
    typeof report.resourceId !== "string" ||
    report.resourceId.trim().length === 0
  ) {
    return {
      ok: false as const,
      reasonCode: REPORT_APPROVAL_REASON_CODES.invalidResource,
      reason:
        "The report resource is missing or unknown. Rebuild the report before sharing.",
    };
  }

  if (report.rows.length === 0) {
    return {
      ok: false as const,
      reasonCode: REPORT_APPROVAL_REASON_CODES.noCurrentEvidence,
      reason: "No saved evidence is available to review.",
    };
  }

  if (!validIsoDate(report.generatedAt)) {
    return {
      ok: false as const,
      reasonCode: REPORT_APPROVAL_REASON_CODES.freshnessUnverified,
      reason: "Evidence freshness could not be verified. Rebuild the report.",
    };
  }

  const hasUnverifiedEvent = report.rows.some((row) => {
    if (!row.event) {
      return false;
    }
    return !isVerifiedEvent(row.event);
  });
  if (hasUnverifiedEvent) {
    return {
      ok: false as const,
      reasonCode: REPORT_APPROVAL_REASON_CODES.evidenceUnverified,
      reason:
        "Every report change needs verified saved evidence before sharing.",
    };
  }

  const hasCurrentEvidence = report.rows.some((row) => {
    if (row.event) return isVerifiedEvent(row.event);
    return (
      report.resourceType === "collection" &&
      validIsoDate(row.landingPage.capturedAt) &&
      Boolean(row.landingPage.url || row.landingPage.headline)
    );
  });
  if (!hasCurrentEvidence) {
    return {
      ok: false as const,
      reasonCode: REPORT_APPROVAL_REASON_CODES.noCurrentEvidence,
      reason: "No current captured evidence is available to review.",
    };
  }

  return { ok: true as const };
}

export function createApprovedReportSnapshot(
  report: ReportDocument,
  reviewedAt = new Date().toISOString(),
) {
  const readiness = evaluateReportReadiness(report);
  if (!readiness.ok || !validIsoDate(reviewedAt)) {
    return null;
  }

  return {
    ...report,
    reviewState: REPORT_REVIEW_STATE,
    evidenceState: REPORT_EVIDENCE_STATE,
    reviewedAt,
    approvalExpiresAt: new Date(
      Date.parse(reviewedAt) + REPORT_APPROVAL_MAX_AGE_MS,
    ).toISOString(),
    evidenceFingerprint: reportEvidenceFingerprint(report),
  } satisfies ReportDocument & ApprovedReportMetadata;
}

export function isApprovedReportSnapshot(
  value: unknown,
): value is ReportDocument & ApprovedReportMetadata {
  return evaluateApprovedReportSnapshot(value).ok;
}

export function evaluateApprovedReportSnapshot(
  value: unknown,
  now = Date.now(),
): { ok: true } | ReportApprovalFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.invalidApproval,
      "The report approval is not a valid saved snapshot.",
    );
  }

  const candidate = value as Record<string, unknown>;
  const reviewedAt =
    typeof candidate.reviewedAt === "string" ? candidate.reviewedAt : null;
  const approvalExpiresAt =
    typeof candidate.approvalExpiresAt === "string"
      ? candidate.approvalExpiresAt
      : null;
  if (
    candidate.reviewState !== REPORT_REVIEW_STATE ||
    candidate.evidenceState !== REPORT_EVIDENCE_STATE ||
    reviewedAt === null ||
    approvalExpiresAt === null ||
    !validIsoDate(reviewedAt) ||
    !validIsoDate(approvalExpiresAt) ||
    typeof candidate.evidenceFingerprint !== "string" ||
    candidate.evidenceFingerprint.length === 0
  ) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.invalidApproval,
      "The report approval is incomplete or malformed. Review the current evidence again.",
    );
  }

  const reviewedAtMs = Date.parse(reviewedAt);
  const approvalExpiresAtMs = Date.parse(approvalExpiresAt);
  if (reviewedAtMs > now) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.approvalInFuture,
      "The report approval timestamp is in the future. Review the current evidence again.",
    );
  }
  if (approvalExpiresAtMs <= now) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.approvalExpired,
      "This report approval has expired. Review the current evidence again.",
    );
  }
  if (
    approvalExpiresAtMs <= reviewedAtMs ||
    approvalExpiresAtMs > reviewedAtMs + REPORT_APPROVAL_MAX_AGE_MS
  ) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.approvalWindowInvalid,
      "The report approval window is invalid. Review the current evidence again.",
    );
  }

  if (!isReportDocument(value)) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.invalidApproval,
      "The saved report approval is not a complete report snapshot.",
    );
  }
  if (
    (candidate.resourceType !== "collection" &&
      candidate.resourceType !== "watchlist") ||
    typeof candidate.reportId !== "string" ||
    candidate.reportId.trim().length === 0 ||
    typeof candidate.resourceId !== "string" ||
    candidate.resourceId.trim().length === 0
  ) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.invalidResource,
      "The report resource is missing or unknown. Rebuild the report before sharing.",
    );
  }
  const report = { ...candidate } as unknown as ReportDocument;
  const readiness = evaluateReportReadiness(report);
  if (!readiness.ok) {
    return readiness;
  }
  const fingerprint = candidate.evidenceFingerprint.startsWith("{")
    ? legacyReportEvidenceFingerprint(report)
    : reportEvidenceFingerprint(report);
  if (fingerprint !== candidate.evidenceFingerprint) {
    return invalidApproval(
      REPORT_APPROVAL_REASON_CODES.fingerprintMismatch,
      "The report changed after review. Review the current evidence again.",
    );
  }
  return { ok: true };
}

function invalidApproval(
  reasonCode: ReportApprovalReasonCode,
  reason: string,
): ReportApprovalFailure {
  return { ok: false, reasonCode, reason };
}

export function reportEvidenceFingerprint(value: ReportDocument) {
  const { generatedAt: _generatedAt, ...content } = value;
  const canonical = stableJson(stripApprovalFields(content));
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

function legacyReportEvidenceFingerprint(value: ReportDocument) {
  const { generatedAt: _generatedAt, ...content } = value;
  return stableJson(stripApprovalFields(content));
}

function isVerifiedEvent(
  event: NonNullable<ReportDocument["rows"][number]["event"]>,
) {
  const proof = event.proofStatusLabel.toLowerCase();
  const source = event.sourceTypeLabel.toLowerCase();
  return (
    (proof === "verified evidence" || proof === "verified proof") &&
    (source === "saved evidence" || source === "proof snapshot")
  );
}

function validIsoDate(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function stripApprovalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripApprovalFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) =>
          ![
            "reviewState",
            "evidenceState",
            "reviewedAt",
            "approvalExpiresAt",
            "evidenceFingerprint",
            "sharePurpose",
          ].includes(key),
      )
      .flatMap(([key, nested]) => {
        const stripped = stripApprovalFields(nested);
        return stripped === undefined ? [] : [[key, stripped]];
      }),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
