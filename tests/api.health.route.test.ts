import { describe, expect, it } from "vitest";

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

describe("health route", () => {
  it("returns a cheap edge-only JSON probe without touching D1", async () => {
    const { loader } = await import("~/routes/api.health");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/health"),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as {
      status: string;
      app: string;
      timestamp: string;
    };
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("exposes bounded worker release identity and normalized rollout mode", async () => {
    const { loader } = await import("~/routes/api.health");
    const response = await loader({
      context: createContext({
        CF_VERSION_METADATA: {
          id: "worker-version-123",
          tag: "release-2026-07-15",
          timestamp: "2026-07-15T10:00:00.000Z",
        },
        SEARCH_ROLLOUT_MODE: "  SHADOW ",
      }),
      request: new Request("https://0509.io/api/health"),
    } as never);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.releaseIdentity).toEqual({
      workerVersionId: "worker-version-123",
      tag: "release-2026-07-15",
      timestamp: "2026-07-15T10:00:00.000Z",
      searchRolloutMode: "shadow",
    });
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("returns null release identity fields when version metadata is absent", async () => {
    const { loader } = await import("~/routes/api.health");
    const response = await loader({
      context: createContext({ SEARCH_ROLLOUT_MODE: "" }),
      request: new Request("https://0509.io/api/health"),
    } as never);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.releaseIdentity).toEqual({
      workerVersionId: null,
      tag: null,
      timestamp: null,
      searchRolloutMode: null,
    });
  });

  it("nulls unbounded or control-character release metadata", async () => {
    const { loader } = await import("~/routes/api.health");
    const response = await loader({
      context: createContext({
        CF_VERSION_METADATA: {
          id: "x".repeat(129),
          tag: "release\nSECRET",
          timestamp: "2026-07-15T10:00:00Z\nSECRET",
        },
        SEARCH_ROLLOUT_MODE: "shadow\nSECRET",
      }),
      request: new Request("https://0509.io/api/health"),
    } as never);

    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("SECRET");
    expect(body).toContain('"workerVersionId":null');
    expect(body).toContain('"tag":null');
    expect(body).toContain('"timestamp":null');
    expect(body).toContain('"searchRolloutMode":null');
  });

  it("falls back to the bounded public app name when APP_NAME is unsafe", async () => {
    const { loader } = await import("~/routes/api.health");
    const response = await loader({
      context: createContext({ APP_NAME: "APP_SECRET\n" + "x".repeat(129) }),
      request: new Request("https://0509.io/api/health"),
    } as never);

    const body = (await response.json()) as { app: string };
    expect(body.app).toBe("0509");
    expect(JSON.stringify(body)).not.toContain("APP_SECRET");
  });
});
