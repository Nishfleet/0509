import { describe, expect, it, vi } from "vitest";

import type {
  AuthenticatedApiAtomicClaimer,
  AuthenticatedApiLimitInput,
  AuthenticatedApiScopeClaim,
} from "~/lib/authenticated-api-limits.server";
import {
  createAuthenticatedApiLimitContext,
  enforceAuthenticatedApiLimit,
  resolveAuthenticatedApiLimitPolicy,
  runWithAuthenticatedApiLimit,
} from "~/lib/authenticated-api-limits.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const identity = {
  workspaceUserId: "workspace-1",
  actorUserId: "actor-1",
  apiKeyId: "key-1",
};

function input(overrides: Partial<AuthenticatedApiLimitInput> = {}): AuthenticatedApiLimitInput {
  return {
    env: {} as never,
    identity,
    operation: "/api/v1/actions",
    ...overrides,
  };
}

function createMemoryClaimer() {
  const rows: Array<{ claim: AuthenticatedApiScopeClaim; now: Date }> = [];
  const calls: AuthenticatedApiScopeClaim[][] = [];
  const claimer: AuthenticatedApiAtomicClaimer = async ({ claims, now }) => {
    calls.push([...claims]);
    const available = claims.every((claim) => {
      const since = now.getTime() - claim.windowSeconds * 1000;
      return rows.filter(
        (row) =>
          row.claim.scope === claim.scope &&
          row.claim.keyHash === claim.keyHash &&
          row.claim.route === claim.route &&
          row.now.getTime() >= since,
      ).length < claim.limit;
    });
    if (!available) return false;
    for (const claim of claims) rows.push({ claim, now });
    return true;
  };
  return { claimer, calls, rows };
}

describe("authenticated API limit policy", () => {
  it("classifies provider actions into a stricter, fail-closed window", () => {
    const write = resolveAuthenticatedApiLimitPolicy({
      operation: "/api/v1/actions",
      actionName: "collection.create",
    });
    const spend = resolveAuthenticatedApiLimitPolicy({
      operation: "/api/v1/actions",
      actionName: "watchlist.refresh",
    });

    expect(write.actionClass).toBe("write");
    expect(spend).toMatchObject({
      actionClass: "provider_spend",
      limit: 10,
      windowSeconds: 600,
      failClosed: true,
      route: "provider:watchlist.refresh",
    });
    expect(spend.limit).toBeLessThan(write.limit);
    expect(resolveAuthenticatedApiLimitPolicy({
      operation: "/api/v1/actions",
      actionName: "support_case.create",
    }).actionClass).toBe("provider_spend");
  });
});

describe("authenticated API identity claims", () => {
  it("does not use request IP or user-agent in the subject keys", async () => {
    const memory = createMemoryClaimer();
    const now = new Date("2026-07-16T12:00:00.000Z");
    const first = await enforceAuthenticatedApiLimit(
      input({
        now,
        actionName: "collection.create",
        claimer: memory.claimer,
        request: new Request("https://0509.io/api/v1/actions", {
          headers: {
            "cf-connecting-ip": "203.0.113.1",
            "user-agent": "first-agent",
          },
        }),
      }),
    );
    const second = await enforceAuthenticatedApiLimit(
      input({
        now,
        claimer: memory.claimer,
        request: new Request("https://0509.io/api/v1/actions", {
          headers: {
            "cf-connecting-ip": "198.51.100.2",
            "user-agent": "rotated-agent",
          },
        }),
      }),
    );

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(memory.calls).toHaveLength(2);
    expect(memory.calls[0]?.map((claim) => claim.keyHash)).toEqual(
      memory.calls[1]?.map((claim) => claim.keyHash),
    );
    expect(memory.calls[0]?.map((claim) => claim.scope)).toEqual([
      "authenticated-api-write:workspace",
      "authenticated-api-write:actor",
      "authenticated-api-write:api_key",
    ]);
  });

  it("does not let another API key reset the workspace scope", async () => {
    const seen = new Set<string>();
    const singleUseClaimer: AuthenticatedApiAtomicClaimer = async ({ claims }) => {
      if (claims.some((claim) => seen.has(`${claim.scope}|${claim.keyHash}|${claim.route}`))) {
        return false;
      }
      for (const claim of claims) seen.add(`${claim.scope}|${claim.keyHash}|${claim.route}`);
      return true;
    };

    const first = await enforceAuthenticatedApiLimit(input({ claimer: singleUseClaimer }));
    const second = await enforceAuthenticatedApiLimit(
      input({
        claimer: singleUseClaimer,
        identity: { ...identity, apiKeyId: "key-2" },
      }),
    );
    const otherWorkspace = await enforceAuthenticatedApiLimit(
      input({
        claimer: singleUseClaimer,
        identity: {
          ...identity,
          workspaceUserId: "workspace-2",
          actorUserId: "actor-2",
          apiKeyId: "key-3",
        },
      }),
    );

    expect(first).toBeNull();
    expect(second?.status).toBe(429);
    expect(otherWorkspace).toBeNull();
  });

  it("enforces the exact provider cap under concurrent calls", async () => {
    const memory = createMemoryClaimer();
    const now = new Date("2026-07-16T12:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 11 }, () =>
        enforceAuthenticatedApiLimit(
          input({
            actionName: "watchlist.refresh",
            now,
            claimer: memory.claimer,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result === null)).toHaveLength(10);
    expect(results.filter((result) => result?.status === 429)).toHaveLength(1);
  });
});

describe("authenticated API execution fencing", () => {
  it("invalidates the captured identity when workspace membership changes", async () => {
    vi.doMock("~/lib/data.server", () => ({
      isActiveCustomerApiKey: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspaceDataUserId: vi.fn().mockResolvedValue("former-member-own-workspace"),
    }));
    const context = createAuthenticatedApiLimitContext({ DB: {} } as never, identity);

    await expect(context.isIdentityActive()).resolves.toBe(false);
  });

  it("blocks a revoked identity before the provider callback", async () => {
    const provider = vi.fn().mockResolvedValue("provider-result");
    const result = await runWithAuthenticatedApiLimit(
      input({
        actionName: "watchlist.refresh",
        claimer: async () => true,
        isIdentityActive: () => false,
      }),
      provider,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("www-authenticate")).toContain("Bearer");
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it("rechecks identity after claiming and before provider invocation", async () => {
    const provider = vi.fn().mockResolvedValue("provider-result");
    let checks = 0;
    const result = await runWithAuthenticatedApiLimit(
      input({
        actionName: "watchlist.refresh",
        claimer: async () => true,
        isIdentityActive: () => {
          checks += 1;
          return checks === 1;
        },
      }),
      provider,
    );

    expect(result.ok).toBe(false);
    expect(checks).toBe(2);
    expect(provider).not.toHaveBeenCalled();
  });

  it("projects the provider window through Retry-After", async () => {
    const response = await enforceAuthenticatedApiLimit(
      input({
        actionName: "watchlist.refresh",
        claimer: async () => false,
      }),
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("600");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("fails closed for provider spend when D1 is unavailable", async () => {
    const response = await enforceAuthenticatedApiLimit(
      input({ actionName: "watchlist.refresh", env: {} as never }),
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("5");
  });

  it("fails closed for authenticated reads when rate-limit storage is unavailable", async () => {
    const response = await enforceAuthenticatedApiLimit(input({ env: {} as never }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "rate_limit_unavailable",
    });
  });

  it("logs only stable categories when a claim or identity check fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await enforceAuthenticatedApiLimit(input({
      actionName: "watchlist.refresh",
      claimer: async () => {
        throw new Error("SQLITE private recipient@example.com bearer-secret");
      },
    }));
    await enforceAuthenticatedApiLimit(input({
      actionName: "watchlist.refresh",
      isIdentityActive: async () => {
        throw new Error("private-key-id recipient@example.com");
      },
      claimer: async () => true,
    }));

    const serialized = JSON.stringify(errorSpy.mock.calls);
    expect(serialized).toContain("claim_failed");
    expect(serialized).toContain("identity_check_failed");
    expect(serialized).not.toContain("recipient@example.com");
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).not.toContain("private-key-id");
  });
});

describe("D1 atomic claim contract", () => {
  it("enforces the exact provider cap atomically in SQLite without storing raw identities", async () => {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db } as never;
    const now = new Date("2026-07-16T12:00:00.000Z");

    try {
      const results = await Promise.all(
        Array.from({ length: 11 }, () =>
          enforceAuthenticatedApiLimit(
            input({
              actionName: "watchlist.refresh",
              env,
              now,
            }),
          ),
        ),
      );

      expect(results.filter((result) => result === null)).toHaveLength(10);
      expect(results.filter((result) => result?.status === 429)).toHaveLength(1);

      const rows = harness.sqlite
        .prepare(
          `SELECT scope, key_hash AS keyHash, route, COUNT(*) AS count
             FROM rate_limit_events
            GROUP BY scope, key_hash, route
            ORDER BY scope`,
        )
        .all() as Array<{
          scope: string;
          keyHash: string;
          route: string;
          count: number;
        }>;

      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.count)).toEqual([10, 10, 10]);
      expect(rows.map((row) => row.scope)).toEqual([
        "authenticated-api-provider-spend:watchlist.refresh:actor",
        "authenticated-api-provider-spend:watchlist.refresh:api_key",
        "authenticated-api-provider-spend:watchlist.refresh:workspace",
      ]);
      for (const row of rows) {
        expect(row.route).toBe("provider:watchlist.refresh");
        expect(row.keyHash).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(JSON.stringify(rows)).not.toContain(identity.workspaceUserId);
      expect(JSON.stringify(rows)).not.toContain(identity.actorUserId);
      expect(JSON.stringify(rows)).not.toContain(identity.apiKeyId);
    } finally {
      harness.close();
    }
  });

  it("fails closed against a real SQLite binding when the rate-limit table is missing", async () => {
    const harness = createSqliteD1();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await enforceAuthenticatedApiLimit(
        input({
          actionName: "watchlist.refresh",
          env: { DB: harness.db } as never,
        }),
      );

      expect(response?.status).toBe(503);
      await expect(response?.json()).resolves.toMatchObject({
        error: "rate_limit_unavailable",
      });
      expect(JSON.stringify(errorSpy.mock.calls)).toContain("claim_failed");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("rate_limit_events");
    } finally {
      errorSpy.mockRestore();
      harness.close();
    }
  });

  it("uses one CTE INSERT for all three independent scopes", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(statement: string) {
          sql = statement;
          return {
            bind() {
              return { run: async () => ({ meta: { changes: 3 } }) };
            },
          };
        },
      },
    } as never;

    const result = await enforceAuthenticatedApiLimit(
      input({ actionName: "watchlist.refresh", env }),
    );

    expect(result).toBeNull();
    expect(sql).toContain("WITH claims");
    expect(sql).toContain("INSERT INTO rate_limit_events");
    expect(sql).not.toContain("cf-connecting-ip");
    expect(sql).not.toContain("user-agent");
  });
});
