/**
 * Bounded, identifier-safe rendering of an exception message for the Gate C
 * journal. The gate's verifier (scripts/verify-post-deploy-release.mjs) only
 * re-projects fields that match a strict charset, so a raw error message
 * (which may carry SQL, tokens, or newlines) never reaches the journal — but
 * the operator still gets the class of failure ("no such table", "Browser
 * Rendering limit", "D1_ERROR ...") instead of an empty payload.
 */
export const CANARY_DETAIL_MAX = 160;
export const CANARY_DETAIL_PATTERN = /^[A-Za-z0-9 _.:/()'-]{1,160}$/u;

export function safeCanaryDetail(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const cleaned = raw.replace(/[^A-Za-z0-9 _.:/()'-]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, CANARY_DETAIL_MAX);
  return cleaned.length > 0 && CANARY_DETAIL_PATTERN.test(cleaned) ? cleaned : "unrenderable_error";
}
