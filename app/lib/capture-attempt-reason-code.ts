/**
 * Public capture-attempt reason codes (issue #1289).
 *
 * The capture-validity gate and the proof pipeline store internal
 * `landing_*` failure codes and `skipped_due_to_*` skip reasons on
 * `proof_capture`. Those tokens are fine for telemetry and tests, but the
 * customer-facing run history (and the `/api/v1/watchlists/:id/runs/latest`
 * response) speaks a smaller, stable public vocabulary so a buyer never has
 * to read `landing_content_signature_too_small` to understand why a check
 * did not produce an alert.
 *
 * This module is the single place that translates an internal failure code
 * (or skip reason) into one of the public reason codes the issue names:
 * `bot_wall`, `cloudflare_challenge`, `cookie_banner`, `partial_load`,
 * `error_page`, `timeout`, `takedown_restore`, `budget_skip`,
 * `extraction_failed`. A succeeded capture has no reason code.
 *
 * The mapping is read-path only — no migration, no stored-value change.
 * `proof_capture` rows stay append-only with their original internal codes.
 */

export type CaptureAttemptStatus =
  | "succeeded"
  | "capture_failed"
  | "skipped_due_to_budget";

/**
 * The public reason-code vocabulary. Every non-success `capture_attempts`
 * entry carries exactly one of these (or `null` when the internal code was
 * empty and we could not classify it — never silently omitted).
 */
export type CaptureAttemptReasonCode =
  | "bot_wall"
  | "cloudflare_challenge"
  | "cookie_banner"
  | "partial_load"
  | "error_page"
  | "timeout"
  | "takedown_restore"
  | "budget_skip"
  | "extraction_failed";

export const CAPTURE_ATTEMPT_REASON_CODES: readonly CaptureAttemptReasonCode[] = [
  "bot_wall",
  "cloudflare_challenge",
  "cookie_banner",
  "partial_load",
  "error_page",
  "timeout",
  "takedown_restore",
  "budget_skip",
  "extraction_failed",
];

/**
 * Internal `landing_*` / `proof_*` failure codes that map to each public
 * reason code. Order matters only for documentation; `toPublicReasonCode`
 * does a direct lookup, so a code appears under exactly one public bucket.
 */
const INTERNAL_TO_PUBLIC: Record<string, CaptureAttemptReasonCode> = {
  // Anti-bot / access walls.
  landing_blocked: "bot_wall",
  landing_challenge_page: "cloudflare_challenge",
  landing_redirect_blocked: "bot_wall",

  // Consent walls that hide the real page.
  landing_cookie_wall: "cookie_banner",

  // Half-loaded / empty shells.
  landing_partial_spa: "partial_load",

  // Error and maintenance screens (the down leg of a takedown/restore
  // cycle lands here too; `takedown_restore` is reserved for the explicit
  // restore signal below).
  landing_error_page: "error_page",
  landing_http_error: "error_page",

  // Could not reach the page in time.
  landing_rate_limited: "timeout",
  landing_fetch_failed: "timeout",
  landing_redirect_limit: "timeout",

  // The page loaded but yielded no usable offer text.
  landing_content_empty_or_oversized: "extraction_failed",
  landing_content_signature_too_small: "extraction_failed",
  landing_url_invalid: "extraction_failed",
  landing_capture_retry_cooldown: "extraction_failed",
  proof_capture_failed: "extraction_failed",

  // Budget gate.
  budget_skip: "budget_skip",
};

/**
 * Metadata key the proof pipeline writes when a capture is the down leg of
 * a takedown/restore cycle (the site served a maintenance/error page and a
 * later capture of the same target succeeded). The run-history read path
 * sets this when it observes the restore, so the public reason code can name
 * the cycle honestly instead of just `error_page`.
 */
export const TAKEDOWN_RESTORE_METADATA_KEY = "takedownRestore";

/**
 * Translate an internal failure code (or skip reason) into a public reason
 * code. Returns `null` for succeeded captures and for unclassifiable empty
 * codes — the caller keeps the row visible with `reason_code: null` rather
 * than dropping it.
 *
 * `isTakedownRestore` flips an `error_page` capture into `takedown_restore`
 * when the read path has confirmed the restore half of the cycle.
 */
export function toPublicReasonCode(
  internalCode: string | null | undefined,
  options: { isTakedownRestore?: boolean } = {},
): CaptureAttemptReasonCode | null {
  const trimmed = internalCode?.trim();
  if (!trimmed) return null;

  if (options.isTakedownRestore) {
    return "takedown_restore";
  }

  if (trimmed === "skipped_due_to_budget") {
    return "budget_skip";
  }

  return INTERNAL_TO_PUBLIC[trimmed] ?? null;
}

/**
 * Map a `proof_capture.status` to the public `capture_attempts` status
 * vocabulary. `skipped_due_to_rate_limit` and `skipped_due_to_dedupe` are
 * not budget skips; they are surfaced as failed captures with their own
 * reason code so the row is never silently dropped.
 */
export function toPublicCaptureStatus(
  status: string,
): CaptureAttemptStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "skipped_due_to_budget") return "skipped_due_to_budget";
  // pending, failed, skipped_due_to_rate_limit, skipped_due_to_dedupe, and
  // any future non-success state all surface as a visible failed attempt.
  return "capture_failed";
}

const REASON_CODE_LABELS: Record<CaptureAttemptReasonCode, string> = {
  bot_wall: "Page blocked the check",
  cloudflare_challenge: "Anti-bot challenge wall",
  cookie_banner: "Cookie consent wall",
  partial_load: "Page only partially loaded",
  error_page: "Page loaded as an error",
  timeout: "Check timed out",
  takedown_restore: "Site was down, then restored",
  budget_skip: "Skipped — plan allowance reached",
  extraction_failed: "Could not read the offer",
};

export function formatCaptureAttemptReasonLabel(
  reasonCode: CaptureAttemptReasonCode | null,
): string {
  if (!reasonCode) return "Check did not produce an alert";
  return REASON_CODE_LABELS[reasonCode];
}
