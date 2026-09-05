import { describe, expect, it, vi } from "vitest";

import {
  enforceAuthenticatedSearchRateLimit,
  enforceBillingProviderRateLimit,
  enforcePublicSearchRateLimit,
  enforcePublicSearchSelectionRateLimit,
  enforceRequestRateLimit,
  enforceSearchSelectionRateLimit,
  rateLimitPolicyFor,
} from "~/lib/rate-limit.server";
import type { AppEnv } from "~/lib/env.server";

describe("rateLimitPolicyFor", () => {
  it("skips the cheap edge health check", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/health"))).toBeNull();
  });

  it("rate-limits the deep health probe under the public api-read bucket", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/api/health/deep"))).toMatchObject({
      scope: "api-read",
      limit: 240,
      failClosed: false,
    });
  });

  it("protects auth routes with a stricter bucket", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/auth/login", { method: "POST" }))).toMatchObject({
      scope: "auth",
      limit: 20,
    });
  });

  it("gives provider webhooks a dedicated higher write ceiling before generic writes", () => {
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/webhooks/dodo", { method: "POST" })),
    ).toMatchObject({
      scope: "webhook",
      limit: 300,
      windowSeconds: 60,
      failClosed: false,
    });
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/webhooks/other", { method: "POST" })),
    ).toMatchObject({
      scope: "webhook",
      limit: 300,
    });
    // Generic app writes stay on the tighter bucket.
    expect(
      rateLimitPolicyFor(new Request("https://0509.io/api/watchlists", { method: "POST" })),
    ).toMatchObject({
      scope: "write",
      limit: 60,
    });
  });

  it("leaves search queries to the route-level anonymous limiter", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/search"))).toBeNull();
    expect(rateLimitPolicyFor(new Request("https://0509.io/search?website=https%3A%2F%2Fnykaa.com"))).toBeNull();
    expect(rateLimitPolicyFor(new Request("https://0509.io/search?query=nykaa", { method: "HEAD" }))).toBeNull();
  });

  it("protects the public status page because it can render cached production evidence", () => {
    expect(rateLimitPolicyFor(new Request("https://0509.io/status"))).toMatchObject({
      scope: "public-status",
      limit: 120,
      keyByIpOnly: true,
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/status", { method: "HEAD" }))).toMatchObject({
      scope: "public-status",
    });
    expect(rateLimitPolicyFor(new Request("https://0509.io/status/"))).toMatchObject({
      scope: "public-status",
    });
  });
});

describe("enforceRequestRateLimit", () => {
  it("blocks requests after the configured auth limit", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.io/auth/login", {
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

  it("defers event inserts through waitUntil while gating on the count", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const deferred: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        deferred.push(promise);
      },
    } as ExecutionContext;
    const request = new Request("https://0509.io/auth/login", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.40",
        "user-agent": "vitest-waituntil",
      },
    });

    for (let index = 0; index < 20; index += 1) {
      await expect(enforceRequestRateLimit(request, env, ctx)).resolves.toBeNull();
      await Promise.all(deferred.splice(0, deferred.length));
    }

    const blocked = await enforceRequestRateLimit(request, env, ctx);
    expect(blocked?.status).toBe(429);
    await Promise.all(deferred.splice(0, deferred.length));
    randomSpy.mockRestore();
  });

  it("fails closed for protected writes when the limiter store is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", { method: "POST" }),
      {} as AppEnv,
    );

    expect(response?.status).toBe(503);
    consoleError.mockRestore();
  });

  it("fails closed for protected writes when the migration has not been applied yet", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", { method: "POST" }),
      { DB: createMissingTableD1() } as unknown as AppEnv,
    );

    expect(response?.status).toBe(503);
    consoleError.mockRestore();
  });

  it("blocks anonymous public search after the configured route limit", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.io/search?query=nykaa", {
      headers: {
        "cf-connecting-ip": "203.0.113.11",
        "user-agent": "vitest",
      },
    });

    for (let index = 0; index < 20; index += 1) {
      await expect(enforcePublicSearchRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicSearchRateLimit(request, env);
    expect(blocked?.status).toBe(429);
    await expect(blocked?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("does not let anonymous public search reset quota by rotating user agent", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < 20; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa", {
        headers: {
          "cf-connecting-ip": "203.0.113.12",
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(enforcePublicSearchRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicSearchRateLimit(
      new Request("https://0509.io/search?query=nykaa", {
        headers: {
          "cf-connecting-ip": "203.0.113.12",
          "user-agent": "brand-new-agent",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("keeps public status slash variants in the same quota bucket", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < 120; index += 1) {
      const path = index % 2 === 0 ? "/status" : "/status////";
      await expect(
        enforceRequestRateLimit(
          new Request(`https://0509.io${path}`, {
            headers: {
              "cf-connecting-ip": "203.0.113.13",
              "user-agent": `rotating-agent-${index}`,
            },
          }),
          env,
        ),
      ).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/status/", {
        headers: {
          "cf-connecting-ip": "203.0.113.13",
          "user-agent": "new-agent",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });
});

describe("enforcePublicSearchSelectionRateLimit", () => {
  it("admits 30 anonymous ad checks then returns 429", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
      headers: {
        "cf-connecting-ip": "203.0.113.21",
        "user-agent": "vitest",
      },
    });

    for (let index = 0; index < 30; index += 1) {
      await expect(enforcePublicSearchSelectionRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicSearchSelectionRateLimit(request, env);
    expect(blocked?.status).toBe(429);
  });

  it("does not let rotating user-agent reset the same IP bucket", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < 30; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: {
          "cf-connecting-ip": "203.0.113.22",
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(enforcePublicSearchSelectionRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicSearchSelectionRateLimit(
      new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: {
          "cf-connecting-ip": "203.0.113.22",
          "user-agent": "brand-new-agent",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("returns null when env.DB is missing (fail-open)", async () => {
    const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
      headers: {
        "cf-connecting-ip": "203.0.113.23",
        "user-agent": "vitest",
      },
    });
    await expect(enforcePublicSearchSelectionRateLimit(request, {} as AppEnv)).resolves.toBeNull();
  });
});

describe("enforceAuthenticatedSearchRateLimit", () => {
  it("blocks a signed-in account after the limit even when it rotates IPs", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    // 60 searches from 60 different IPs: same account, same 10-min burst bucket.
    // Use agency so the daily plan budget (1000) does not trip first.
    for (let index = 0; index < 60; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa", {
        headers: {
          "cf-connecting-ip": `203.0.113.${index % 250}`,
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(
        enforceAuthenticatedSearchRateLimit(request, env, "user-1", undefined, "agency"),
      ).resolves.toBeNull();
    }

    const blocked = await enforceAuthenticatedSearchRateLimit(
      new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
      }),
      env,
      "user-1",
      undefined,
      "agency",
    );
    expect(blocked?.status).toBe(429);

    // a different account is unaffected
    await expect(
      enforceAuthenticatedSearchRateLimit(
        new Request("https://0509.io/search?query=nykaa", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-2",
      ),
    ).resolves.toBeNull();
  });
});

describe("enforceSearchSelectionRateLimit", () => {
  it("claims the warm-selection budget synchronously instead of deferring admission", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const waitUntil = vi.fn();

    try {
      await expect(
        enforceSearchSelectionRateLimit(
          new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
          env,
          "user-1",
          { waitUntil } as unknown as ExecutionContext,
        ),
      ).resolves.toBeNull();

      expect(waitUntil).not.toHaveBeenCalled();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("admits at most 120 concurrent warm selections", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const results = await Promise.all(
      Array.from({ length: 121 }, () =>
        enforceSearchSelectionRateLimit(
          new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
          env,
          "user-concurrent",
        ),
      ),
    );

    expect(results.filter((result) => result === null)).toHaveLength(120);
    expect(results.filter((result) => result?.status === 429)).toHaveLength(1);
  });

  it("refuses the 121st warm selection in the window without touching the fresh-search bucket", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < 120; index += 1) {
      const request = new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: {
          "cf-connecting-ip": `203.0.113.${index % 250}`,
          "user-agent": `rotating-agent-${index}`,
        },
      });
      await expect(
        enforceSearchSelectionRateLimit(request, env, "user-1"),
      ).resolves.toBeNull();
    }

    const blocked = await enforceSearchSelectionRateLimit(
      new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
        headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
      }),
      env,
      "user-1",
    );
    expect(blocked?.status).toBe(429);

    // separate buckets: an exhausted selection bucket never blocks fresh searches
    await expect(
      enforceAuthenticatedSearchRateLimit(
        new Request("https://0509.io/search?query=nykaa", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-1",
      ),
    ).resolves.toBeNull();

    // a different account is unaffected
    await expect(
      enforceSearchSelectionRateLimit(
        new Request("https://0509.io/search?query=nykaa&selected=meta-1", {
          headers: { "cf-connecting-ip": "198.51.100.99", "user-agent": "fresh" },
        }),
        env,
        "user-2",
      ),
    ).resolves.toBeNull();
  });

  it("fails closed when the limiter store is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { DB: createMissingTableD1() } as unknown as AppEnv;

    const response = await enforceSearchSelectionRateLimit(
      new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
      env,
      "user-1",
    );

    expect(response?.status).toBe(503);
    consoleError.mockRestore();
  });
});

describe("enforceBillingProviderRateLimit", () => {
  it("keys the shared budget by workspace owner across rotating IPs and user agents", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    for (let index = 0; index < 5; index += 1) {
      await expect(
        enforceBillingProviderRateLimit(
          new Request("https://0509.io/api/billing/dodo/checkout", {
            headers: {
              "cf-connecting-ip": `203.0.113.${index}`,
              "user-agent": `rotating-${index}`,
            },
          }),
          env,
          "owner-1",
          "mutation",
        ),
      ).resolves.toBeNull();
    }
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/portal", {
          headers: { "cf-connecting-ip": "198.51.100.20", "user-agent": "fresh" },
        }),
        env,
        "owner-1",
        "mutation",
      ),
    ).resolves.toMatchObject({ status: 429 });
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/portal", {
          headers: { "cf-connecting-ip": "198.51.100.20", "user-agent": "fresh" },
        }),
        env,
        "owner-2",
        "mutation",
      ),
    ).resolves.toBeNull();
  });

  it("uses one atomic claim per request under concurrency", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        enforceBillingProviderRateLimit(
          new Request("https://0509.io/api/billing/dodo/checkout", {
            headers: { "cf-connecting-ip": `203.0.113.${index}` },
          }),
          env,
          "owner-concurrent",
          "mutation",
        ),
      ),
    );
    expect(results.filter((result) => result === null)).toHaveLength(5);
    expect(results.filter((result) => result?.status === 429)).toHaveLength(3);
  });

  it("fails closed before a provider call when D1 or its table is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/checkout"),
        {} as AppEnv,
        "owner-1",
        "mutation",
      ),
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      enforceBillingProviderRateLimit(
        new Request("https://0509.io/api/billing/dodo/checkout"),
        { DB: createMissingTableD1() } as unknown as AppEnv,
        "owner-1",
        "mutation",
      ),
    ).resolves.toMatchObject({ status: 503 });
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
                if (sql.includes("SELECT COUNT(*)")) {
                  const [id, scope, keyHash, route, createdAt, _scope, _keyHash, _route, since, limit] = args;
                  const count = rows.filter(
                    (row) =>
                      row.scope === String(scope) &&
                      row.keyHash === String(keyHash) &&
                      row.route === String(route) &&
                      row.createdAt >= String(since),
                  ).length;
                  if (count < Number(limit)) {
                    rows.push({
                      scope: String(scope),
                      keyHash: String(keyHash),
                      route: String(route),
                      createdAt: String(createdAt),
                    });
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                rows.push({
                  scope: String(args[1]),
                  keyHash: String(args[2]),
                  route: String(args[3]),
                  createdAt: String(args[4]),
                });
              }
              if (sql.includes("DELETE FROM rate_limit_events")) {
                // Bind shape: [...longScopes, cutoff, ...longScopes, longWindowCutoff]
                const scopeCount = (args.length - 2) / 2;
                const longScopes = new Set(args.slice(0, scopeCount).map(String));
                const cutoff = String(args[scopeCount]);
                const longWindowCutoff = String(args[args.length - 1]);
                for (let index = rows.length - 1; index >= 0; index -= 1) {
                  const row = rows[index]!;
                  const expired = longScopes.has(row.scope)
                    ? row.createdAt < longWindowCutoff
                    : row.createdAt < cutoff;
                  if (expired) rows.splice(index, 1);
                }
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
