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
    const prepare = vi.fn().mockReturnValue({ first });
    const { loader } = await import("~/routes/api.health.deep");
    const response = await loader({
      context: createContext({
        DB: { prepare },
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-19",
          timestamp: "2026-07-19T06:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "shadow",
      }),
      request: new Request("https://0509.io/api/health/deep"),
    } as never);

    expect(prepare).toHaveBeenCalledWith("SELECT 1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      status: string;
      app: string;
      checks: { edge: string; d1: string };
      releaseIdentity: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
      checks: { edge: "ok", d1: "ok" },
      releaseIdentity: {
        workerVersionId: "worker-version-123",
        tag: "release-2026-07-19",
        timestamp: "2026-07-19T06:00:00.000Z",
        searchRolloutMode: "shadow",
      },
    });
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
