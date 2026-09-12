import { describe, expect, it, vi } from "vitest";

import {
  enforceAuthenticatedSearchRateLimit,
  enforceBillingProviderRateLimit,
  enforcePublicBrandPageRateLimit,
  enforcePublicSearchRateLimit,
  enforcePublicSearchSelectionRateLimit,
  enforceRequestRateLimit,
  enforceSearchSelectionRateLimit,
  PUBLIC_BRAND_PAGE_LIMIT,
  PUBLIC_SEARCH_ANON_BROWSER_LIMIT,
  PUBLIC_SEARCH_IP_BACKSTOP_LIMIT,
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
  });

  it("never issues a DELETE on the request path — cleanup is the daily cron's job (issue #2402)", async () => {
    // Regression lock for the deleted 2% lottery: even with Math.random
    // forced to a guaranteed "win", no request may carry a cleanup DELETE.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const base = createFakeD1();
    const issuedDeletes: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          if (sql.includes("DELETE FROM rate_limit_events")) issuedDeletes.push(sql);
          return base.prepare(sql);
        },
      },
    } as unknown as AppEnv;
    const deferred: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        deferred.push(promise);
      },
    } as ExecutionContext;

    try {
      await enforceRequestRateLimit(
        new Request("https://0509.io/auth/login", {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.60", "user-agent": "vitest" },
        }),
        env,
        ctx,
      );
      await enforceRequestRateLimit(
        new Request("https://0509.io/auth/login", {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.61", "user-agent": "vitest" },
        }),
        env,
      );
      await enforceSearchSelectionRateLimit(
        new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
        env,
        "user-1",
        ctx,
      );
      await Promise.all(deferred.splice(0, deferred.length));

      expect(issuedDeletes).toHaveLength(0);
    } finally {
      randomSpy.mockRestore();
    }
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

  it("gives each anonymous browser its own budget while keeping a per-IP backstop", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = (userAgent: string) =>
      new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "203.0.113.11", "user-agent": userAgent },
      });

    // 20 searches under ONE anonymousId pass; the 21st under the SAME id is 429.
    for (let index = 0; index < PUBLIC_SEARCH_ANON_BROWSER_LIMIT; index += 1) {
      await expect(
        enforcePublicSearchRateLimit(request(`vitest-${index}`), env, undefined, "browser-a"),
      ).resolves.toBeNull();
    }
    const blockedOwn = await enforcePublicSearchRateLimit(
      request("vitest-21"),
      env,
      undefined,
      "browser-a",
    );
    expect(blockedOwn?.status).toBe(429);

    // A DIFFERENT anonymousId on the SAME IP still passes (per-browser buckets).
    await expect(
      enforcePublicSearchRateLimit(request("vitest-22"), env, undefined, "browser-b"),
    ).resolves.toBeNull();
  });

  it("lets a fresh anonymous browser search even when its shared per-IP bucket is near the ceiling", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = (userAgent: string) =>
      new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": userAgent },
      });

    // Push the shared per-IP public-search ceiling (100/10min) near its limit
    // with cookie-less / new-id requests — the fleet or other NAT visitors
    // share this counter.
    for (let index = 0; index < PUBLIC_SEARCH_IP_BACKSTOP_LIMIT - 1; index += 1) {
      await expect(enforcePublicSearchRateLimit(request(`visitor-${index}`), env)).resolves.toBeNull();
    }

    // A genuinely fresh no-cookie browser (new anonId) can still issue a search
    // even though the shared per-IP counter is near its ceiling.
    await expect(
      enforcePublicSearchRateLimit(request("fresh-browser"), env, undefined, "fresh-browser-id"),
    ).resolves.toBeNull();
  });

  it("lets a fresh browser search after 19 other browsers on the same NAT IP already searched", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.io/search?query=nykaa", {
      headers: { "cf-connecting-ip": "203.0.113.55" },
    });

    for (let index = 0; index < PUBLIC_SEARCH_ANON_BROWSER_LIMIT - 1; index += 1) {
      await expect(
        enforcePublicSearchRateLimit(request, env, undefined, `nat-browser-${index}`),
      ).resolves.toBeNull();
    }

    await expect(
      enforcePublicSearchRateLimit(request, env, undefined, "nat-browser-fresh"),
    ).resolves.toBeNull();
  });

  it("keys all headerless requests into one shared unknown bucket (spoofed XFF cannot mint identities)", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    // No cf-connecting-ip at all. Every one of these carries a DIFFERENT
    // spoofed x-forwarded-for AND a different user-agent — under the old XFF
    // fallback each minted its own identity. They must all land in the single
    // `unknown` bucket and share the auth cap (20).
    const spoofedIps = ["198.51.100.1", "203.0.113.9", "192.0.2.44"];
    for (let index = 0; index < 20; index += 1) {
      const request = new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "x-forwarded-for": spoofedIps[index % spoofedIps.length]!,
          "user-agent": `spoofed-agent-${index}`,
        },
      });
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }

    // The 21st headerless request — a brand-new spoofed XFF and a brand-new
    // user-agent — still shares the exhausted shared bucket.
    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.77",
          "user-agent": "brand-new-spoof",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("ignores spoofed x-forwarded-for when a real cf-connecting-ip is present", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    // Same cf-connecting-ip and user-agent across every request, but a
    // different spoofed x-forwarded-for each time. Keys must all collide on
    // the trusted IP, so the x-forwarded-for value must not affect the bucket.
    for (let index = 0; index < 20; index += 1) {
      const request = new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.50",
          "x-forwarded-for": `1.2.3.${index}`,
          "user-agent": "same-browser",
        },
      });
      await expect(enforceRequestRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforceRequestRateLimit(
      new Request("https://0509.io/auth/login", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.50",
          "x-forwarded-for": "9.9.9.9",
          "user-agent": "same-browser",
        },
      }),
      env,
    );
    expect(blocked?.status).toBe(429);
  });

  it("keeps the per-IP public-search backstop throttling once the IP ceiling is exceeded", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = (userAgent: string) =>
      new Request("https://0509.io/search?query=nykaa", {
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": userAgent },
      });

    for (let index = 0; index < PUBLIC_SEARCH_IP_BACKSTOP_LIMIT; index += 1) {
      await expect(enforcePublicSearchRateLimit(request(`agent-${index}`), env)).resolves.toBeNull();
    }

    // Even a brand-new anonymousId cannot bypass the exhausted per-IP backstop.
    const blocked = await enforcePublicSearchRateLimit(
      request("fresh"),
      env,
      undefined,
      "any-browser",
    );
    expect(blocked?.status).toBe(429);
  });

  it("does not let anonymous public search reset quota by rotating user agent", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;

    for (let index = 0; index < PUBLIC_SEARCH_IP_BACKSTOP_LIMIT; index += 1) {
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
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const waitUntil = vi.fn();

    await expect(
      enforceSearchSelectionRateLimit(
        new Request("https://0509.io/search?query=nykaa&selected=meta-1"),
        env,
        "user-1",
        { waitUntil } as unknown as ExecutionContext,
      ),
    ).resolves.toBeNull();

    expect(waitUntil).not.toHaveBeenCalled();
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

// Issue #3156 — the public brand-page bucket must cover a full BET-5 sitemap
// crawl at Googlebot pace from one shared IP, and any 429 it does return must
// carry Retry-After so well-behaved crawlers back off cleanly.
describe("public brand-page crawler budget (issue #3156)", () => {
  // BET 5 targets a >=1,000-URL sitemap. At the observed crawl shape
  // (~1 URL per 3 s, 2 requests per URL: status probe + noindex probe)
  // one IP needs ~400 requests per 10-minute window. The limit must be
  // comfortably above that so a crawl-paced pass never 429s mid-sitemap.
  it("clears the BET-5 sitemap crawl budget (1,000 URLs, 2 probes/URL, 1 URL/3s)", async () => {
    // ~200 URLs per 10-min window at 1 URL/3 s, ×2 probes each = ~400 requests.
    const requestsPerCrawlWindow = Math.ceil((600 / 3) * 2);
    expect(PUBLIC_BRAND_PAGE_LIMIT).toBeGreaterThanOrEqual(requestsPerCrawlWindow);
    expect(PUBLIC_BRAND_PAGE_LIMIT).toBe(600);
  });

  it("returns a 429 with a Retry-After header when the crawl budget is exhausted", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const request = new Request("https://0509.io/ads/puma.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.77",
        "user-agent": "seo-crawler-sim",
      },
    });

    for (let index = 0; index < 600; index += 1) {
      await expect(enforcePublicBrandPageRateLimit(request, env)).resolves.toBeNull();
    }

    const blocked = await enforcePublicBrandPageRateLimit(request, env);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBeTruthy();
  });

  it("exempts a verified search crawler using the cf-verified-bot header from the brand-page budget", async () => {
    const env = { DB: createFakeD1() } as unknown as AppEnv;
    const verified = new Request("https://0509.io/ads/puma.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.78",
        "user-agent": "Googlebot",
        "cf-verified-bot": "true",
      },
    });

    // More than the anonymous limit's worth of requests — all admitted.
    for (let index = 0; index < 610; index += 1) {
      await expect(enforcePublicBrandPageRateLimit(verified, env)).resolves.toBeNull();
    }
  });
});
