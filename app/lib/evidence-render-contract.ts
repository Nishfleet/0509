import type { ProofCaptureRecord, WatchEventRecord } from "~/lib/types";
import { hasOrderedCapturePair } from "~/components/evidence/diff-plate";

/**
 * The customer-facing evidence render contract (tri-audit T16, thin form).
 *
 * A route must not pass arbitrary status strings into a proof component and
 * hope the copy stays honest. Every decision surface resolves an event to
 * ONE of these states first; the guards below are the single place the
 * honesty rules live:
 *
 * - `verified_change` requires a confirmed event, a succeeded capture, and a
 *   correctly ordered before/after pair — only this state may render a
 *   verified diff or increment a confirmed-moves count.
 * - `provisional_signal` (detected / proof pending) may invite review but
 *   can never read as proven or lead an overnight claim.
 * - `suppressed_signal` and `invalidated_signal` are audit records: never in
 *   decision counts, never above a verified change.
 * - `check_failed` can never produce a quiet "nothing changed" claim.
 * - `unknown` renders as unknown — not as healthy.
 */
export type CustomerEvidenceState =
  | "verified_change"
  | "provisional_signal"
  | "suppressed_signal"
  | "invalidated_signal"
  | "check_failed"
  | "unknown";

export function resolveCustomerEvidenceState(input: {
  event: WatchEventRecord;
  proofCapture?: ProofCaptureRecord | null;
  beforeCapturedAt?: string | null;
  nowCapturedAt?: string | null;
}): CustomerEvidenceState {
  const { event } = input;
  if (event.status === "suppressed") return "suppressed_signal";
  if (event.status === "invalidated") return "invalidated_signal";
  if (event.status === "proof_failed") return "check_failed";
  if (event.status === "detected" || event.status === "proof_pending") {
    return "provisional_signal";
  }
  if (event.status === "confirmed") {
    const captureOk = input.proofCapture
      ? input.proofCapture.status === "succeeded"
      : true;
    const pairOk =
      input.beforeCapturedAt !== undefined || input.nowCapturedAt !== undefined
        ? hasOrderedCapturePair(input.beforeCapturedAt, input.nowCapturedAt)
        : true;
    return captureOk && pairOk ? "verified_change" : "provisional_signal";
  }
  return "unknown";
}

/** Only a verified change may render a diff presented as proven. */
export function canRenderVerifiedDiff(state: CustomerEvidenceState): boolean {
  return state === "verified_change";
}

/** Only a verified change may increment a confirmed-moves count. */
export function countsAsConfirmedMove(state: CustomerEvidenceState): boolean {
  return state === "verified_change";
}

/** Audit records may never appear in decision feeds or above findings. */
export function isAuditOnly(state: CustomerEvidenceState): boolean {
  return state === "suppressed_signal" || state === "invalidated_signal";
}

/**
 * A quiet claim ("nothing changed", "all quiet") is itself a proof claim —
 * it may only be made when the check actually completed.
 */
export function canClaimQuiet(state: CustomerEvidenceState): boolean {
  return state !== "check_failed" && state !== "unknown";
}
