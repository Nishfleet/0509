import type { WatchEventRecord } from "~/lib/types";

export type CustomerProofStatus =
  | "verified_proof"
  | "scan_spotted"
  | "needs_review"
  | "proof_pending"
  | "proof_failed"
  | "suppressed"
  | "invalidated"
  | "internal_only"
  | "canary_or_test"
  | "unknown";

export interface ProofClassification {
  status: CustomerProofStatus;
  label: string;
  sourceType: "proof_snapshot" | "scheduled_scan" | "manual" | "internal" | "unknown";
  sourceTypeLabel: string;
  exclusionReasons: string[];
}

export interface ProofMix {
  verifiedProof: number;
  scanSpotted: number;
  needsReview: number;
  proofPending: number;
  proofFailed: number;
  excluded: number;
  unknown: number;
}

export interface PriorityMix {
  high: number;
  medium: number;
  low: number;
}

export interface SourceCoverageSummary {
  proofMix: ProofMix;
  excludedCounts: Record<string, number>;
  totalInput: number;
  included: number;
  excluded: number;
  note: string;
}

export interface DigestTrustItem {
  eventType?: string;
  metadata?: Record<string, unknown>;
  proofStatus?: string;
  title?: string;
  summary?: string;
  watchlistName?: string;
  createdAt?: string;
  id?: string;
  eventId?: string;
  watchlistId?: string;
}

export function classifyDigestItemSource(item: DigestTrustItem): ProofClassification {
  const metadata = normalizedMetadata(item.metadata);
  return classifyFromStatus({
    status: readString(metadata.status) ?? readString(item.proofStatus) ?? readString(metadata.eventStatus),
    proofCaptureId: readString(metadata.proofCaptureId),
    sourceStatus: readString(metadata.sourceStatus),
    proofStatus: readString(metadata.proofStatus),
    metadata,
  });
}

export function classifyWatchEventSource(event: WatchEventRecord): ProofClassification {
  return classifyFromStatus({
    status: event.status,
    proofCaptureId: event.proofCaptureId,
    sourceStatus: watchEventSourceStatus(event),
    proofStatus: readString(event.metadata.proofStatus),
    metadata: event.metadata,
    suppressed: Boolean(event.suppressedAt),
    invalidated: Boolean(event.invalidatedAt),
  });
}

export function filterClientReportWatchEvents(
  events: WatchEventRecord[],
  options: { allowScanSpotted?: boolean } = {},
) {
  const rows = events.map((event) => {
    const classification = classifyWatchEventSource(event);
    return {
      event,
      classification,
      eligible: isClientReportEligibleClassification(classification, options),
    };
  });
  const eligibleEvents = rows.filter((row) => row.eligible).map((row) => row.event);
  const excludedRows = rows.filter((row) => !row.eligible);

  return {
    eligibleEvents,
    excludedEvents: excludedRows.map((row) => row.event),
    sourceCoverage: buildSourceCoverageSummary(
      rows.map((row) => row.classification),
      eligibleEvents.length,
    ),
  };
}

export function isClientReportEligibleWatchEvent(
  event: WatchEventRecord,
  options: { allowScanSpotted?: boolean } = {},
) {
  return isClientReportEligibleClassification(classifyWatchEventSource(event), options);
}

// Decision candidacy is an allowlist, not a blocklist: only statuses that
// represent a completed, customer-trustable observation may enter ranked
// decision flows or become the recommended finding. proof_pending,
// needs_review, and unknown can be displayed with honest labels, but an
// unqualified item must be prevented from ranking — not cautioned after
// selection.
const DIGEST_DECISION_CANDIDATE_STATUSES: readonly CustomerProofStatus[] = [
  "verified_proof",
  "scan_spotted",
];

export function isDigestDecisionCandidate(item: DigestTrustItem) {
  const status = classifyDigestItemSource(item).status;
  return DIGEST_DECISION_CANDIDATE_STATUSES.includes(status);
}

export function summarizeDigestProofMix(items: DigestTrustItem[]): ProofMix {
  return buildProofMix(items.map(classifyDigestItemSource));
}

export function summarizeWatchEventProofMix(events: WatchEventRecord[]): ProofMix {
  return buildProofMix(events.map(classifyWatchEventSource));
}

export function summarizePriorityMix(
  items: Array<{ importanceScore?: number | null; metadata?: Record<string, unknown> }>,
): PriorityMix {
  return items.reduce(
    (counts, item) => {
      const bucket = priorityBucket(item.importanceScore ?? readNumber(item.metadata?.priorityScore), item.metadata);
      counts[bucket] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

export function proofStatusLabel(status: CustomerProofStatus) {
  return PROOF_STATUS_LABELS[status];
}

export function proofMixLabel(mix: ProofMix) {
  const proofUnavailable = mix.proofPending + mix.proofFailed + mix.unknown;
  return [
    mix.verifiedProof ? `${mix.verifiedProof} verified evidence` : null,
    mix.scanSpotted ? `${mix.scanSpotted} check-spotted` : null,
    mix.needsReview ? `${mix.needsReview} needs review` : null,
    proofUnavailable ? `${proofUnavailable} evidence unavailable` : null,
    mix.excluded ? `${mix.excluded} excluded from client report` : null,
  ].filter(Boolean).join(" · ") || "No evidence signals yet";
}

export function priorityMixLabel(mix: PriorityMix) {
  return `${mix.high} high · ${mix.medium} medium · ${mix.low} low`;
}

export function sourceCoverageNote(summary: SourceCoverageSummary) {
  return summary.note;
}

function classifyFromStatus(input: {
  status: string | null;
  proofCaptureId: string | null;
  sourceStatus: string | null;
  proofStatus: string | null;
  metadata: Record<string, unknown>;
  suppressed?: boolean;
  invalidated?: boolean;
}): ProofClassification {
  if (input.suppressed || input.status === "suppressed") {
    return classification("suppressed", ["suppressed"]);
  }
  if (input.invalidated || input.status === "invalidated") {
    return classification("invalidated", ["invalidated"]);
  }
  if (isInternalOnlyMetadata(input.metadata)) {
    return classification("internal_only", ["internal_only"]);
  }
  if (isCanaryOrTestMetadata(input.metadata)) {
    return classification("canary_or_test", ["canary_or_test"]);
  }
  if (input.status === "internal_only") {
    return classification("internal_only", ["internal_only"]);
  }
  if (input.status === "canary_or_test") {
    return classification("canary_or_test", ["canary_or_test"]);
  }
  if (
    input.status === "proof_failed" ||
    input.proofStatus === "failed" ||
    input.sourceStatus === "proof_failed"
  ) {
    return classification("proof_failed", ["proof_failed"]);
  }
  if (input.status === "proof_pending" || input.proofStatus === "pending") {
    return classification("proof_pending", ["proof_pending"]);
  }
  if (input.status === "detected" || truthy(input.metadata.provisional) || truthy(input.metadata.needsReview)) {
    return classification("needs_review", ["needs_review"]);
  }
  if (input.status === "needs_review") {
    return classification("needs_review", ["needs_review"]);
  }
  if (input.status === "verified_proof") {
    return classification("verified_proof", []);
  }
  if (input.status === "scan_spotted") {
    return classification("scan_spotted", []);
  }
  if (input.proofCaptureId || input.sourceStatus === "proof_backed") {
    return classification("verified_proof", []);
  }
  if (input.sourceStatus === "scan_backed" || input.status === "confirmed") {
    return classification("scan_spotted", input.status === "confirmed" ? ["scan_only"] : []);
  }
  return classification("unknown", ["unknown_source"]);
}

function classification(status: CustomerProofStatus, exclusionReasons: string[]): ProofClassification {
  const sourceType = sourceTypeForStatus(status);
  return {
    status,
    label: PROOF_STATUS_LABELS[status],
    sourceType,
    sourceTypeLabel: SOURCE_TYPE_LABELS[sourceType],
    exclusionReasons,
  };
}

function isClientReportEligibleClassification(
  classification: ProofClassification,
  options: { allowScanSpotted?: boolean },
) {
  if (classification.status === "verified_proof") {
    return true;
  }
  return Boolean(options.allowScanSpotted && classification.status === "scan_spotted");
}

function buildSourceCoverageSummary(
  classifications: ProofClassification[],
  included: number,
): SourceCoverageSummary {
  const proofMix = buildProofMix(classifications);
  const excludedCounts = classifications.reduce<Record<string, number>>((counts, item) => {
    for (const reason of item.exclusionReasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
    if (item.exclusionReasons.length === 0 && item.status !== "verified_proof") {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }
    return counts;
  }, {});
  const totalInput = classifications.length;
  const excluded = Math.max(totalInput - included, 0);
  return {
    proofMix,
    excludedCounts,
    totalInput,
    included,
    excluded,
    note:
      excluded > 0
        ? `${included} verified-evidence event${included === 1 ? "" : "s"} included. ${excluded} non-client-ready event${excluded === 1 ? "" : "s"} excluded from this report.`
        : `${included} verified-evidence event${included === 1 ? "" : "s"} included. No non-client-ready watch events were present.`,
  };
}

function buildProofMix(classifications: ProofClassification[]): ProofMix {
  return classifications.reduce(
    (counts, item) => {
      switch (item.status) {
        case "verified_proof":
          counts.verifiedProof += 1;
          break;
        case "scan_spotted":
          counts.scanSpotted += 1;
          break;
        case "needs_review":
          counts.needsReview += 1;
          break;
        case "proof_pending":
          counts.proofPending += 1;
          break;
        case "proof_failed":
          counts.proofFailed += 1;
          break;
        case "unknown":
          counts.unknown += 1;
          break;
        default:
          counts.excluded += 1;
      }
      return counts;
    },
    {
      verifiedProof: 0,
      scanSpotted: 0,
      needsReview: 0,
      proofPending: 0,
      proofFailed: 0,
      excluded: 0,
      unknown: 0,
    },
  );
}

function sourceTypeForStatus(status: CustomerProofStatus): ProofClassification["sourceType"] {
  if (status === "verified_proof") {
    return "proof_snapshot";
  }
  if (status === "scan_spotted" || status === "needs_review" || status === "proof_pending") {
    return "scheduled_scan";
  }
  if (status === "internal_only" || status === "canary_or_test") {
    return "internal";
  }
  return "unknown";
}

function priorityBucket(
  score: number | null,
  metadata?: Record<string, unknown>,
): keyof PriorityMix {
  if (score !== null) {
    if (score >= 85) return "high";
    if (score >= 65) return "medium";
    return "low";
  }
  const band = readString(metadata?.priorityBand)?.toLowerCase() ?? "";
  if (band.includes("high")) return "high";
  if (band.includes("medium")) return "medium";
  return "low";
}

function normalizedMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function watchEventSourceStatus(event: WatchEventRecord) {
  const sourceStatus = readString(event.metadata.sourceStatus);
  return sourceStatus === "proof_backed" && !event.proofCaptureId ? null : sourceStatus;
}

function isInternalOnlyMetadata(metadata: Record<string, unknown>) {
  return truthy(metadata.internalOnly) ||
    truthy(metadata.internal_only) ||
    truthy(metadata.isInternal) ||
    truthy(metadata.is_internal) ||
    readString(metadata.lane) === "internal";
}

function isCanaryOrTestMetadata(metadata: Record<string, unknown>) {
  if (truthy(metadata.canary) || truthy(metadata.isCanary) || truthy(metadata.testOnly)) {
    return true;
  }
  const searchable = [
    readString(metadata.kind),
    readString(metadata.source),
    readString(metadata.runKey),
    readString(metadata.campaign),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(canary|debug|test)\b/.test(searchable) ||
    searchable.includes("launch_readiness_canary");
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "true" || value === "1";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const PROOF_STATUS_LABELS: Record<CustomerProofStatus, string> = {
  verified_proof: "Verified evidence",
  scan_spotted: "Check-spotted",
  needs_review: "Needs review",
  proof_pending: "Evidence unavailable",
  proof_failed: "Evidence unavailable",
  suppressed: "Excluded from client report",
  invalidated: "Excluded from client report",
  internal_only: "Excluded from client report",
  canary_or_test: "Excluded from client report",
  unknown: "Evidence unavailable",
};

const SOURCE_TYPE_LABELS: Record<ProofClassification["sourceType"], string> = {
  proof_snapshot: "Saved evidence",
  scheduled_scan: "Scheduled check",
  manual: "Manual evidence",
  internal: "Source unavailable",
  unknown: "Source unavailable",
};
