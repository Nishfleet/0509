import { formatProofCaptureStatusLabel } from "~/lib/landing-page-display";
import { formatLandingPageCaptureGap } from "~/lib/search-display";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
} from "~/lib/types";

/**
 * Run-history visibility for captures we refused to alert on (BET 4 Part 2,
 * issue #969 / Q9). Failed, skipped, and suppressed captures already exist
 * as rows; this module is the single place that turns them into explained
 * history entries. A failed capture is never an alert.
 */

export type RunHistoryRefusalKind =
  | "capture_failed"
  | "skipped_due_to_budget"
  | "skipped_due_to_rate_limit"
  | "skipped_due_to_dedupe"
  | `suppressed_${string}`;

export interface RunHistoryRefusalRow {
  id: string;
  kind: RunHistoryRefusalKind;
  /** Machine token for tests and telemetry — never shown raw to the customer. */
  reasonCode: string;
  /** Sentence-case status for the history row. */
  label: string;
  /** Why we refused, in product voice. */
  explanation: string;
  attemptedAt: string;
  /** Always false: these rows exist so the refusal is visible, not sent. */
  generatesAlert: false;
}

const SUPPRESSED_REASON_EXPLANATIONS: Record<string, string> = {
  proof_duplicate: "Same change already recorded",
  candidate_duplicate: "Same possible change already recorded",
  delivery_duplicate: "Already batched for delivery",
  unconfirmed_by_screenshot: "Screenshot did not match the extracted change",
  churn_stable: "Only a timestamp changed",
  ad_slot_strip: "Only a rotating banner changed",
};

export function formatRunHistoryRefusalCopy(row: RunHistoryRefusalRow): string {
  return `${row.label} — ${row.explanation}. No alert sent.`;
}

export function resolveProofCaptureRefusal(
  capture: Pick<
    ProofCaptureRecord,
    "id" | "status" | "skipReason" | "failureCode" | "failureReason" | "attemptedAt"
  >,
): RunHistoryRefusalRow | null {
  if (capture.status === "failed") {
    const reasonCode = capture.failureCode?.trim() || "proof_capture_failed";
    return {
      id: capture.id,
      kind: "capture_failed",
      reasonCode,
      label: "Capture failed",
      explanation: formatLandingPageCaptureGap(reasonCode).proofLabel,
      attemptedAt: capture.attemptedAt,
      generatesAlert: false,
    };
  }

  if (
    capture.status === "skipped_due_to_budget" ||
    capture.status === "skipped_due_to_rate_limit" ||
    capture.status === "skipped_due_to_dedupe"
  ) {
    return {
      id: capture.id,
      kind: capture.status,
      reasonCode: capture.skipReason ?? capture.status,
      label: "Skipped",
      explanation: formatProofCaptureStatusLabel(capture.status).replace(
        /^Skipped — /,
        "",
      ),
      attemptedAt: capture.attemptedAt,
      generatesAlert: false,
    };
  }

  return null;
}

export function resolveSuppressedCandidateRefusal(
  candidate: Pick<
    EventCandidateRecord,
    "id" | "status" | "skipReason" | "dedupeReason" | "metadata" | "detectedAt"
  >,
): RunHistoryRefusalRow | null {
  if (candidate.status !== "suppressed") return null;

  const reason = suppressedReasonFromCandidate(candidate);
  return suppressedRow({
    id: candidate.id,
    reason,
    attemptedAt: candidate.detectedAt,
  });
}

export function resolveSuppressedEventRefusal(
  event: Pick<WatchEventRecord, "id" | "status" | "metadata" | "createdAt" | "suppressedAt">,
): RunHistoryRefusalRow | null {
  if (event.status !== "suppressed") return null;

  const reason = suppressedReasonFromMetadata(event.metadata);
  return suppressedRow({
    id: event.id,
    reason,
    attemptedAt: event.suppressedAt ?? event.createdAt,
  });
}

export function buildRunHistoryRefusalRows(input: {
  captures?: readonly ProofCaptureRecord[];
  candidates?: readonly EventCandidateRecord[];
  events?: readonly WatchEventRecord[];
}): RunHistoryRefusalRow[] {
  const rows: RunHistoryRefusalRow[] = [];
  const seen = new Set<string>();

  const push = (row: RunHistoryRefusalRow | null) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };

  for (const capture of input.captures ?? []) {
    push(resolveProofCaptureRefusal(capture));
  }
  for (const candidate of input.candidates ?? []) {
    push(resolveSuppressedCandidateRefusal(candidate));
  }
  for (const event of input.events ?? []) {
    push(resolveSuppressedEventRefusal(event));
  }

  return rows.sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt));
}

function suppressedRow(input: {
  id: string;
  reason: string;
  attemptedAt: string;
}): RunHistoryRefusalRow {
  const explanation =
    SUPPRESSED_REASON_EXPLANATIONS[input.reason] ?? "Low-signal change was not confirmed";
  return {
    id: input.id,
    kind: `suppressed_${input.reason}`,
    reasonCode: input.reason,
    label: "Suppressed",
    explanation,
    attemptedAt: input.attemptedAt,
    generatesAlert: false,
  };
}

function suppressedReasonFromCandidate(
  candidate: Pick<EventCandidateRecord, "dedupeReason" | "skipReason" | "metadata">,
): string {
  if (candidate.dedupeReason) return candidate.dedupeReason;
  if (candidate.skipReason) return candidate.skipReason;
  return suppressedReasonFromMetadata(candidate.metadata);
}

function suppressedReasonFromMetadata(metadata: Record<string, unknown> | null | undefined): string {
  if (metadata?.corroboration === "unconfirmed_by_screenshot") {
    return "unconfirmed_by_screenshot";
  }
  const dedupe = metadata?.dedupeReason;
  if (typeof dedupe === "string" && dedupe.trim()) return dedupe.trim();
  return "low_signal";
}
