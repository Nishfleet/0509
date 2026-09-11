import { describe, expect, it, vi } from "vitest";

import {
  SCHEDULED_OBSERVATION_GAP_CHECK_ACTIVATION_GRACE_MS,
  SCHEDULED_OBSERVATION_GAP_CHECK_MAX_AGE_MS,
} from "~/lib/scheduled-observation-health.server";

const HOUR_MS = 60 * 60 * 1000;

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

/**
 * Minimal R2 stand-in for the gap-check heartbeat object. `heartbeat` is the
 * payload the bucket currently holds; null means no object has been written.
 */
function createBucket(
  heartbeat: { lastRunAt: string } | null = null,
  options: { readThrows?: boolean } = {},
) {
  return {
    get: vi.fn(async () => {
      if (options.readThrows) throw new Error("object storage unavailable");
      if (!heartbeat) return null;
      return { json: async () => heartbeat };
    }),
    put: vi.fn(async () => undefined),
  };
}

function healthySoakDb(baselineAt: string, observedAt: string) {
  const first = vi.fn().mockResolvedValue({ "1": 1 });
  const prepare = vi.fn((sql: string) => {
    if (sql === "SELECT 1") return { first };
    const statement = {
      bind: vi.fn(() => statement),
      all: vi.fn().mockResolvedValue({
        results: sql.includes("release_scheduled_observation")
          ? [
              "0 */3 * * *",
              "17 */6 * * *",
              "0 4 * * *",
              "0 5 * * MON",
            ].map((cron) => ({
              cron,
              last_scheduled_at: observedAt,
              future_observation_count: 0,
            }))
          : [
              "0 */3 * * *",
              "17 */6 * * *",
              "0 4 * * *",
              "0 5 * * MON",
            ].map((cron) => ({ cron, baseline_at: baselineAt })),
      }),
    };
    return statement;
  });
  return { prepare, first };
}

function idleSoakDb() {
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
  return { prepare, first };
}

describe("deep health route", () => {
  it("omits releaseIdentity for anonymous callers", async () => {
    const first = vi.fn().mockResolvedValue({ "1": 1 });
    const prepare = vi.fn((sql: string) => {
      if (sql === "SELECT 1") return { first };
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn().mockResolvedValue({
          results: [
            "0 */3 * * *",
            "17 */6 * * *",
            "0 4 * * *",
            "0 5 * * MON",
          ].map((cron) => ({ cron, baseline_at: new Date().toISOString() })),
        }),
      };
      return statement;
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: createBucket({
          lastRunAt: new Date().toISOString(),
        }),
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-19",
          timestamp: "2026-07-19T06:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "v2",
        CANARY_BYPASS_TOKEN: "secret-token",
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("releaseIdentity");
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
      checks: { edge: "ok", d1: "ok", scheduledWork: "ok" },
    });
  });

  it("includes releaseIdentity for a tokened caller", async () => {
    const first = vi.fn().mockResolvedValue({ "1": 1 });
    const prepare = vi.fn((sql: string) => {
      if (sql === "SELECT 1") return { first };
      const statement = {
        bind: vi.fn(() => statement),
        all: vi.fn().mockResolvedValue({
          results: [
            "0 */3 * * *",
            "17 */6 * * *",
            "0 4 * * *",
            "0 5 * * MON",
          ].map((cron) => ({ cron, baseline_at: new Date().toISOString() })),
        }),
      };
      return statement;
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: createBucket({
          lastRunAt: new Date().toISOString(),
        }),
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-19",
          timestamp: "2026-07-19T06:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "v2",
        CANARY_BYPASS_TOKEN: "secret-token",
      }),
      request: new Request("https://0509.io/api/health/deep", {
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);

    expect(response.status).toBe(200);
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
    const bucket = createBucket({ lastRunAt: new Date().toISOString() });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: bucket,
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-19",
          timestamp: "2026-07-19T06:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "v2",
        CANARY_BYPASS_TOKEN: "secret-token",
      }),
      request: new Request("https://0509.io/api/health/deep", {
        headers: { "x-0509-canary-token": "secret-token" },
      }),
    } as never);

    expect(prepare).toHaveBeenCalledWith("SELECT 1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      status: string;
      app: string;
      checks: {
        edge: string;
        d1: string;
        scheduledWork: string;
        scheduledGapCheck: string;
      };
      releaseIdentity: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
      checks: {
        edge: "ok",
        d1: "ok",
        scheduledWork: "ok",
        scheduledGapCheck: "ok",
      },
      releaseIdentity: {
        workerVersionId: "worker-version-123",
        tag: "release-2026-07-19",
        timestamp: "2026-07-19T06:00:00.000Z",
        searchRolloutMode: "v2",
      },
    });
  });

  it("returns degraded 503 when scheduled-work evidence is overdue", async () => {
    const { prepare } = idleSoakDb();
    const bucket = createBucket({ lastRunAt: new Date().toISOString() });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: bucket,
        CANARY_BYPASS_TOKEN: "secret-token",
      }),
      request: new Request("https://0509.io/api/health/deep", {
        headers: { "x-0509-canary-token": "secret-token" },
      }),
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
      "errorReports",
      "releaseIdentity",
      "status",
      "timestamp",
    ]);
    expect(Object.keys(body.checks).sort()).toEqual([
      "d1",
      "edge",
      "scheduledGapCheck",
      "scheduledWork",
    ]);
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

  it("marks only scheduledGapCheck degraded when the gap-check heartbeat is stale and the workload schedules are fresh", async () => {
    const now = new Date();
    const { prepare } = healthySoakDb(
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    );
    const bucket = createBucket({
      lastRunAt: new Date(
        now.getTime() - SCHEDULED_OBSERVATION_GAP_CHECK_MAX_AGE_MS - HOUR_MS,
      ).toISOString(),
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: bucket,
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { scheduledWork: string; scheduledGapCheck: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.scheduledWork).toBe("ok");
    expect(body.checks.scheduledGapCheck).toBe("degraded");
  });

  it("keeps both scheduledWork and scheduledGapCheck ok when the heartbeat is fresh", async () => {
    const now = new Date();
    const { prepare } = healthySoakDb(
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    );
    const bucket = createBucket({
      lastRunAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: bucket,
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      checks: { scheduledWork: string; scheduledGapCheck: string };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.scheduledWork).toBe("ok");
    expect(body.checks.scheduledGapCheck).toBe("ok");
  });

  it("reports scheduledGapCheck missing and stays degraded when no heartbeat bucket is bound", async () => {
    const { prepare } = healthySoakDb(
      new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    );
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({ DB: { prepare } }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { d1: string; scheduledWork: string; scheduledGapCheck: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.checks).toMatchObject({
      d1: "ok",
      scheduledWork: "ok",
      scheduledGapCheck: "missing",
    });
  });

  it("stays ok on a fresh version that has not written its first heartbeat yet", async () => {
    const now = new Date();
    const { prepare } = healthySoakDb(
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    );
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: createBucket(),
        CF_VERSION_METADATA: {
          id: "worker-version-fresh",
          timestamp: new Date(now.getTime() - 60 * 1000).toISOString(),
        },
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      checks: { scheduledWork: string; scheduledGapCheck: string };
    };
    expect(body.status).toBe("ok");
    expect(body.checks).toMatchObject({
      scheduledWork: "ok",
      scheduledGapCheck: "ok",
    });
    const serialized = JSON.stringify(body);
    for (const privateDetail of [
      "cron-heartbeats/",
      "gap-check.json",
      "lastRunAt",
      "13 * * * *",
    ]) {
      expect(serialized).not.toContain(privateDetail);
    }
  });

  it("degrades an absent heartbeat once the version is older than one cadence", async () => {
    const now = new Date();
    const { prepare } = healthySoakDb(
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    );
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        LANDING_PAGE_ARTIFACTS: createBucket(),
        CF_VERSION_METADATA: {
          id: "worker-version-old",
          timestamp: new Date(
            now.getTime() -
              SCHEDULED_OBSERVATION_GAP_CHECK_ACTIVATION_GRACE_MS -
              HOUR_MS,
          ).toISOString(),
        },
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { scheduledWork: string; scheduledGapCheck: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.scheduledWork).toBe("ok");
    expect(body.checks.scheduledGapCheck).toBe("degraded");
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
