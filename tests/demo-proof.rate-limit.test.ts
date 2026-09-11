import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enforceRequestRateLimit,
  PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT,
  rateLimitPolicyFor,
} from "~/lib/rate-limit.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * The /api/demo-proof limiter (issues #2964 and #2985).
 *
 * #2964 found the endpoint had no limiter at all; the interim D1 bucket
 * failed OPEN exactly when D1 was degraded. #2985 replaces it with the
 * native Cloudflare Rate Limiting binding (scope "public-proof-brief",
 * counted at the edge, off D1) and it now FAILS CLOSED:
 *   1. an exhausted per-IP bucket is a labeled 429 with a Retry-After,
 *      before any proof-brief cache read happens;
 *   2. a degraded edge limiter (binding missing or throwing) also returns
 *      429 + Retry-After on this public hot path — never fail-open;
 *   3. the burst gate works with the endpoint completely intact: an
 *      exhausted bucket does not write rate_limit_events rows.
 */

type Limiter = {
  binding: { limit(this: void, params: { key: string; rate: { requestsPerPeriod: number } }): Promise<{ success: boolean }> };
  counts: Map<string, number>;
};

function createFakeRateLimiter(options?: {
  throwOn?: (key: string) => boolean;
}): Limiter {
  const counts = new Map<string, number>();
  return {
    binding: {
      async limit(params) {
        if (options?.throwOn?.(params.key)) throw new Error("edge limiter unavailable");
        const count = (counts.get(params.key) ?? 0) + 1;
        if (count > params.rate.requestsPerPeriod) {
          counts.set(params.key, count - 1);
          return { success: false };
        }
        counts.set(params.key, count);
        return { success: true };
      },
    },
    counts,
  };
}

function demoProofRequest(ip: string) {
  return new Request("https://0509.io/api/demo-proof", {
    headers: { "cf-connecting-ip": ip },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("the /api/demo-proof edge limiter (issues #2964 and #2985)", () => {
  it("the policy is a dedicated fail-closed edge scope with the legacy 30/10min budget as 3/60s", () => {
    expect(rateLimitPolicyFor(demoProofRequest("203.0.113.7"))).toMatchObject({
      scope: "public-proof-brief",
      limit: 3,
      periodSeconds: 60,
      keyByIpOnly: true,
    });
    expect(PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT).toBe(3);
  });

  it("an exhausted burst returns a labeled 429 with Retry-After from the edge limiter", async () => {
    const { binding } = createFakeRateLimiter();
    const env = { RATE_LIMITER: binding } as unknown as AppEnv;

    for (let i = 0; i < PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT; i++) {
      await expect(enforceRequestRateLimit(demoProofRequest("203.0.113.7"), env)).resolves.toBeNull();
    }
    const blocked = await enforceRequestRateLimit(demoProofRequest("203.0.113.7"), env);

    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    expect(await blocked?.json()).toEqual({
      error: "rate_limited",
      message: "Too many requests. Please try again shortly.",
    });
  });

  it("fails CLOSED with 429 when the edge limiter is missing or throwing — a degraded edge 429s, it never admits unbounded traffic", async () => {
    const missing = { RATE_LIMITER: undefined } as unknown as AppEnv;
    const missingResponse = await enforceRequestRateLimit(demoProofRequest("203.0.113.7"), missing);
    expect(missingResponse?.status).toBe(429);
    expect(missingResponse?.headers.get("retry-after")).toBe("60");

    const { binding } = createFakeRateLimiter({ throwOn: (key) => key.length > 0 });
    const env = { RATE_LIMITER: binding } as unknown as AppEnv;
    const thrownResponse = await enforceRequestRateLimit(demoProofRequest("203.0.113.7"), env);
    expect(thrownResponse?.status).toBe(429);
    expect(thrownResponse?.headers.get("retry-after")).toBe("60");
  });

  it("across a full burst, zero rows touch the D1 hot path (the #2964 fail-open write path is gone)", async () => {
    const writes: string[] = [];
    const { binding } = createFakeRateLimiter();
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            writes.push(sql);
            return { meta: { changes: 1 } };
          },
        }),
      }),
    };
    const env = { RATE_LIMITER: binding, DB: db } as unknown as AppEnv;

    for (let i = 0; i < PUBLIC_PROOF_BRIEF_PER_MINUTE_LIMIT; i++) {
      await expect(enforceRequestRateLimit(demoProofRequest("203.0.113.7"), env)).resolves.toBeNull();
    }
    const burst = await enforceRequestRateLimit(demoProofRequest("203.0.113.7"), env);
    expect(burst?.status).toBe(429);
    expect(writes).toEqual([]);
  });
});
