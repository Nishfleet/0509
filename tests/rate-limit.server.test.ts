import { describe, expect, it, vi } from "vitest";

import { enforceRequestRateLimit, rateLimitPolicyFor } from "~/lib/rate-limit.server";
import type { AppEnv } from "~/lib/env.server";

describe("rateLimitPolicyFor", () => {
  it("skips the health check", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.in/api/health"))).toBeNull();
  });

  it("protects auth routes with a stricter bucket", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.in/auth/login", { method: "POST" }))).toMatchObject({
      scope: "auth",
      limit: 20,
    });
  });
});

describe("enforceRequestRateLimit", () => {
  it("blocks requests after the configured auth limit", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.in/auth/login", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "user-agent": "vitest",
      },
    });

    for (let index = 0; index < 20; index += 1) {
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(request, env);
    expect(blocked?.status).toBe(429);
    await expect(blocked?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("fails closed for protected writes when the limiter store is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.in/auth/login", { method: "POST" }),
      {} as AppEnv,
    );

    expect(response?.status).toBe(503);
    consoleError.mockRestore();
  });

  it("fails open when the migration has not been applied yet", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.in/auth/login", { method: "POST" }),
      { DB: createMissingTableD1() } as unknown as AppEnv,
    );

    expect(response).toBeNull();
    consoleError.mockRestore();
  });
});

function createFakeD1() {
  const rows: { scope: string; keyHash: string; route: string; createdAt: string }[] = [];

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.includes("INSERT INTO rate_limit_events")) {
                rows.push({
                  scope: String(args[1]),
                  keyHash: String(args[2]),
                  route: String(args[3]),
                  createdAt: String(args[4]),
                });
              }
              if (sql.includes("DELETE FROM rate_limit_events")) {
                rows.splice(0, rows.length);
              }
              return {};
            },
            async first<T>() {
              if (!sql.includes("SELECT COUNT(*) AS count")) return null;
              const [scope, keyHash, route, since] = args.map(String);
              const count = rows.filter(
                (row) =>
                  row.scope === scope &&
                  row.keyHash === keyHash &&
                  row.route === route &&
                  row.createdAt >= since,
              ).length;
              return { count } as T;
            },
          };
        },
      };
    },
  };
}

function createMissingTableD1() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              throw new Error("no such table: rate_limit_events");
            },
            async first() {
              throw new Error("no such table: rate_limit_events");
            },
          };
        },
      };
    },
  };
}
