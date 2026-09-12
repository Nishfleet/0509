import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_PROOF_LIMIT } from "~/lib/rate-limit.server";

/**
 * Proof-brief limiter gate (issue #2964).
 *
 * The deep audit found /api/demo-proof had NO rate-limit policy at all while
 * /status advertises limits on the public surfaces ("abuse BOTH, medium").
 * This file pins two things:
 *  1. an exhausted per-IP bucket for /api/demo-proof is a labeled 429 with a
 *     Retry-After, BEFORE any proof-brief cache read happens;
 *  2. when D1 errors, the public bucket fails OPEN (never dead-ends a
 *     buyer) but the fail-open event names its scope in the logs, so the
 *     "no limit applied" state is observable — the structural fail-closed
 *     replacement is #2985.
 */

type BindTarget = { bind: (..._args: unknown[]) => { first: () => Promise<unknown>; run: () => Promise<unknown> } };

function fakeDbWithCount(count: number) {
  const queries: string[] = [];
  const db = {
    prepare: (sql: string) => {
      queries.push(sql);
      const bound: BindTarget = {
        bind: () => ({
          first: async () => ({ count }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
      return bound;
    },
  };
  return { db, queries };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("the /api/demo-proof limiter (issue #2964)", () => {
  it("an exhausted public-proof-brief bucket returns a labeled 429 with Retry-After", async () => {
    const { db } = fakeDbWithCount(DEMO_PROOF_LIMIT);
    const { enforceDemoProofRateLimit } = await import("~/lib/rate-limit.server");
    const response = await enforceDemoProofRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      // E2E bypass is keyed off the env object; absent means production path.
      { DB: db } as never,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await response?.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("a request within budget is allowed and the event is counted", async () => {
    const { db, queries } = fakeDbWithCount(0);
    const { enforceDemoProofRateLimit } = await import("~/lib/rate-limit.server");
    const response = await enforceDemoProofRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      { DB: db } as never,
    );

    expect(response).toBeNull();
    expect(queries.some((sql) => sql.includes("rate_limit_events"))).toBe(true);
  });

  it("a D1 hiccup fails OPEN on the public bucket — and the log names the scope", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenDb = {
      prepare: () => {
        throw new Error("D1 degraded");
      },
    };
    const { enforceDemoProofRateLimit } = await import("~/lib/rate-limit.server");
    const response = await enforceDemoProofRateLimit(
      new Request("https://0509.io/api/demo-proof", {
        headers: { "cf-connecting-ip": "203.0.113.7" },
      }),
      { DB: brokenDb } as never,
    );

    // Fail-open: the buyer can still evaluate the product (issue #1972
    // posture). The structural fail-closed replacement is #2985.
    expect(response).toBeNull();
    const logged = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("public-proof-brief");
    expect(logged).toContain("NOT enforced");
  });

  it("the route enforces the limiter before reading the proof brief", async () => {
    const limiter429 = new Response(
      JSON.stringify({ error: "rate_limited", message: "Too many requests." }),
      { status: 429, headers: { "retry-after": "42" } },
    );
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforceDemoProofRateLimit: vi.fn().mockResolvedValue(limiter429),
    }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn(async () => {
        throw new Error("brief must not be read once the bucket is exhausted");
      }),
    }));

    const route = await import("~/routes/api.demo-proof");
    const response = await route.loader({
      request: new Request("https://0509.io/api/demo-proof"),
      context: { cloudflare: { env: {} } },
    } as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });
});
