import type { ProofCaptureRecord, WatchEventRecord } from "~/lib/types";
import { hasOrderedCapturePair } from "~/components/evidence/diff-plate";

/**
 * The customer-facing evidence render contract (tri-audit T16, thin form).
 *
 * A route must not pass arbitrary status strings into a proof component and
 * hope the copy stays honest. Every decision surface resolves an event to
 * ONE of these states first; the guards below are the single place the
 * honesty rules live. The contract FAILS CLOSED: evidence that is not
 * presented to the resolver is treated as absent, never as satisfied.
 *
 * - `verified_change` requires a confirmed event AND a succeeded capture AND
 *   a correctly ordered before/after pair — only this state may render a
 *   verified diff, own the green mark, or increment a confirmed-moves count.
 * - `observed_no_change` is a completed check that found nothing — the only
 *   state that may claim quiet.
 * - `provisional_signal` (detected / proof pending / confirmed-but-
 *   unevidenced) may invite review but can never read as proven or quiet.
 * - `suppressed_signal` and `invalidated_signal` are audit records: never in
 *   decision counts, never rendered as a diff, never above a finding.
 * - `check_failed` can never produce a quiet claim.
 * - `unknown` renders as unknown — not as healthy.
 */
export type CustomerEvidenceState =
  | "verified_change"
  | "observed_no_change"
  | "provisional_signal"
  | "suppressed_signal"
  | "invalidated_signal"
  | "check_failed"
  | "unknown";

export function resolveCustomerEvidenceState(input: {
  event: WatchEventRecord;
  proofCapture: ProofCaptureRecord | null;
  beforeCapturedAt: string | null | undefined;
  nowCapturedAt: string | null | undefined;
}): CustomerEvidenceState {
  const { event } = input;
  if (event.status === "suppressed") return "suppressed_signal";
  if (event.status === "invalidated") return "invalidated_signal";
  if (event.status === "proof_failed") return "check_failed";
  if (event.status === "detected" || event.status === "proof_pending") {
    return "provisional_signal";
  }
  if (event.status === "confirmed") {
    // Fail closed: a confirmed status alone is a claim, not evidence. The
    // capture must have succeeded and both timestamps must exist and be
    // ordered, or the event degrades to a provisional signal.
    const captureSucceeded = input.proofCapture?.status === "succeeded";
    const pairOrdered = hasOrderedCapturePair(
      input.beforeCapturedAt,
      input.nowCapturedAt,
    );
    return captureSucceeded && pairOrdered ? "verified_change" : "provisional_signal";
  }
  return "unknown";
}

/**
 * A completed check with no events is the only honest "quiet". Callers pass
 * the run outcome, not an event.
 */
export function resolveQuietState(input: {
  checkCompleted: boolean;
}): CustomerEvidenceState {
  return input.checkCompleted ? "observed_no_change" : "unknown";
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
 * only a completed check that observed nothing may make it. A provisional
 * signal means something MIGHT have changed, so the period is not quiet.
 */
export function canClaimQuiet(state: CustomerEvidenceState): boolean {
  return state === "observed_no_change";
}
