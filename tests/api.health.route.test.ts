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

    const body = (await response.json()) as { status: string; app: string; timestamp: string };
    expect(body).toMatchObject({
      status: "ok",
      app: "0509",
    });
    expect(typeof body.timestamp).toBe("string");
  });
});
