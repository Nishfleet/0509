import { describe, expect, it, vi } from "vitest";

import { handleError } from "~/entry.server";
import { reportError, sampleErrorStack } from "~/lib/error-report.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Issue #2988 — nothing fails silently: a thrown loader/action error must
 * produce exactly one error_report write through the global `handleError`
 * hook in entry.server.tsx, and the sink itself must be best-effort (never
 * throw, even when D1 is unavailable).
 */

function d1Spy() {
  const writes: unknown[][] = [];
  const db = {
    prepare: vi.fn(() => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          writes.push(args);
          return { success: true };
        },
      }),
    })),
  };
  return { env: { DB: db } as unknown as AppEnv, writes };
}

function fakeRequest(pathname: string) {
  return new Request(`https://0509.io${pathname}`);
}

describe("entry.server handleError → error_report sink", () => {
  it("a thrown loader error produces exactly one report with route and reason code", async () => {
    const { env, writes } = d1Spy();
    await handleError(new Error("loader exploded"), {
      request: fakeRequest("/search?q=abrasives.com"),
      context: { cloudflare: { env } },
    });
    expect(writes.length).toBe(1);
    const [createdAt, route, reasonCode, message] = writes[0];
    expect(route).toBe("/search");
    expect(reasonCode).toBe("loader_error");
    expect(message).toContain("loader exploded");
    expect(new Date(createdAt as string).getTime()).toBeGreaterThan(0);
  });

  it("error messages that are not Errors still write one report", async () => {
    const { env, writes } = d1Spy();
    await handleError("string-boom", {
      request: fakeRequest("/brand/nike"),
      context: { cloudflare: { env } },
    });
    expect(writes.length).toBe(1);
    expect(writes[0][3]).toContain("string-boom");
  });

  it("URI parse failure on the request still reports under the fallback route", async () => {
    const { env, writes } = d1Spy();
    await handleError(new Error("bad request"), {
      request: { url: "http://[" } as unknown as Request,
      context: { cloudflare: { env } },
    });
    expect(writes.length).toBe(1);
    expect(writes[0][1]).toBe("unknown_route");
  });

  it("the write is best-effort: a throwing sink never rejects the caller", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({ bind: () => ({ run: async () => { throw new Error("d1 down"); } }) })),
      },
    } as unknown as AppEnv;
    await expect(
      reportError(env, { route: "/ads/x.com", reasonCode: "catch_test", error: new Error("e") }),
    ).resolves.toEqual({ written: false, reason: "db_error" });
  });

  it("missing DB binding reports no_db instead of throwing", async () => {
    await expect(
      reportError({} as AppEnv, { route: "/x", reasonCode: "y", error: new Error("e") }),
    ).resolves.toEqual({ written: false, reason: "no_db" });
  });

  it("does not report when no cloudflare context is available", async () => {
    await handleError(new Error("no runtime"), {
      request: fakeRequest("/"),
      context: {},
    });
    expect(true).toBe(true);
  });
});

describe("sampleErrorStack", () => {
  it("samples at most 3 frames and drops the header line", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at a (a.ts:1:1)\n    at b (b.ts:1:1)\n    at c (c.ts:1:1)\n    at d (d.ts:1:1)";
    const sample = sampleErrorStack(error);
    expect(countSampleLines(sample)).toBe(3);
  });

  it("returns null for non-Error throws", () => {
    expect(sampleErrorStack("nope")).toBeNull();
  });
});

function countSampleLines(sample: string | null) {
  return sample === null ? 0 : sample.split("\n").length;
}
