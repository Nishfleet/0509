import { describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env: {
        APP_NAME: "0509",
        ...env,
      },
    },
  };
}

describe("deep health route", () => {
  it("returns ok with per-dependency status when D1 answers SELECT 1", async () => {
    const first = vi.fn().mockResolvedValue({ "1": 1 });
    const baseline = new Date().toISOString();
    const prepare = vi.fn((sql: string) => {
      if (sql === "SELECT 1") return { first };
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn().mockResolvedValue({
          results: sql.includes("release_scheduled_observation")
            ? []
            : [
                "0 */3 * * *",
                "17 */6 * * *",
                "0 4 * * *",
                "0 5 * * MON",
              ].map((cron) => ({ cron, baseline_at: baseline })),
        }),
      };
      return statement;
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-19",
          timestamp: "2026-07-19T06:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "v2",
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(prepare).toHaveBeenCalledWith("SELECT 1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      status: string;
      app: string;
      checks: { edge: string; d1: string; scheduledWork: string };
      releaseIdentity: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
      checks: { edge: "ok", d1: "ok", scheduledWork: "ok" },
      releaseIdentity: {
        workerVersionId: "worker-version-123",
        tag: "release-2026-07-19",
        timestamp: "2026-07-19T06:00:00.000Z",
        searchRolloutMode: "v2",
      },
    });
  });

  it("returns degraded 503 when scheduled-work evidence is overdue", async () => {
    const first = vi.fn().mockResolvedValue({ "1": 1 });
    const prepare = vi.fn((sql: string) => {
      if (sql === "SELECT 1") return { first };
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn().mockResolvedValue({
          results: sql.includes("release_scheduled_observation")
            ? []
            : [
                "0 */3 * * *",
                "17 */6 * * *",
                "0 4 * * *",
                "0 5 * * MON",
              ].map((cron) => ({
                cron,
                baseline_at: "2026-01-01T00:00:00.000Z",
              })),
        }),
      };
      return statement;
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({ DB: { prepare } }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown> & {
      checks: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      status: "degraded",
      checks: { d1: "ok", scheduledWork: "degraded" },
    });
    expect(Object.keys(body).sort()).toEqual([
      "app",
      "checks",
      "releaseIdentity",
      "status",
      "timestamp",
    ]);
    expect(Object.keys(body.checks).sort()).toEqual(["d1", "edge", "scheduledWork"]);
    const serialized = JSON.stringify(body);
    for (const privateDetail of [
      "0 */3 * * *",
      "2026-01-01T00:00:00.000Z",
      "customer@example.com",
      "provider_failure_detail",
      "raw error",
    ]) {
      expect(serialized).not.toContain(privateDetail);
    }
  });

  it("returns degraded 503 when D1 is missing", async () => {
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({}),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { d1: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.d1).toBe("missing");
  });

  it("returns degraded 503 when D1 SELECT 1 throws", async () => {
    const first = vi.fn().mockRejectedValue(new Error("db down"));
    const prepare = vi.fn().mockReturnValue({ first });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({ DB: { prepare } }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { d1: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.d1).toBe("error");
  });
});
