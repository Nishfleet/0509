import type { AppEnv } from "~/lib/env.server";

const CANARY_TOKEN_HEADER = "x-0509-canary-token";

/**
 * Canonical canary-bypass authorization check. True only when a
 * CANARY_BYPASS_TOKEN is configured and the request carries the matching
 * `x-0509-canary-token` header.
 *
 * The comparison is constant-time so a probe cannot distinguish a near-miss
 * token from a mismatch; `CANARY_BYPASS_TOKEN` guards privileged gates
 * (404/409 access, fresh-live search, pricing overrides), so timing must not
 * leak the secret.
 */
export function hasValidCanaryToken(env: AppEnv, request: Request): boolean {
  const configured = env.CANARY_BYPASS_TOKEN?.trim();
  if (!configured) {
    return false;
  }

  const provided = request.headers.get(CANARY_TOKEN_HEADER) ?? "";
  return constantTimeEqual(provided, configured);
}

function constantTimeEqual(a: string, b: string): boolean {
  // Seed the accumulator with the length difference and always loop over the
  // longer length so neither the length nor the content position early-exits.
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
