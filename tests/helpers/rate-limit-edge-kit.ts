import type { AppEnv } from "~/lib/env.server";

/**
 * Shared fake of the native Cloudflare Rate Limiting bindings used by the
 * rate-limit unit tests (`tests/rate-limit.server.test.ts`,
 * `tests/rate-limit-canary-bypass.server.test.ts`). Extracted from the former
 * when the #3278 canary-bypass tests pushed it past the tests/ 800-line
 * ratchet (tests/file-size-ratchet.test.ts).
 *
 * Mirrors the RL_* binding capacities declared in wrangler.jsonc (issue
 * #2985): capacity lives ON the binding and the runtime call is
 * `limit({ key })`, so the fake enforces the same per-binding limit the
 * platform would. Each policy's scope is part of the key, so per-binding
 * counting against the configured limit matches production semantics.
 */
export const EDGE_BINDING_LIMITS: Record<string, number> = {
  RL_AUTH: 2,
  RL_SEARCH_ANON_BROWSER: 2,
  RL_PROOF_BRIEF: 3,
  RL_SEARCH_SELECTION: 3,
  RL_SEARCH_IP: 10,
  RL_BRAND_PAGE: 12,
  RL_WRITE: 60,
  RL_STATUS: 120,
  RL_DELIVERY_WEBHOOK: 180,
  RL_API_READ: 240,
  RL_WEBHOOK: 300,
};

export function createFakeEdgeLimiters(options?: {
  failures?: (key: string) => boolean;
  throwOn?: (key: string) => boolean;
}): { env: AppEnv } {
  const counts = new Map<string, number>();
  const makeLimiter = (bindingLimit: number) => ({
    async limit(params: { key: string }) {
      const key = params.key;
      if (options?.throwOn?.(key)) throw new Error("edge limiter unavailable");
      if (options?.failures?.(key)) return { success: false };
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > bindingLimit) {
        // Do not retain rejected bursts; matches a rolling-window counter.
        counts.set(key, count - 1);
        return { success: false };
      }
      return { success: true };
    },
  });
  const env = Object.fromEntries(
    Object.entries(EDGE_BINDING_LIMITS).map(([name, limit]) => [name, makeLimiter(limit)]),
  ) as unknown as AppEnv;
  return { env };
}
