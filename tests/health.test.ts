import { describe, expect, it } from "vitest";

import { healthResponse } from "../app/lib/observability/health.server";

function dbReturning(row: { ok: number } | null): D1Database {
  return {
    prepare: () => ({ first: () => Promise.resolve(row) }),
  } as unknown as D1Database;
}

function dbRejecting(error: Error): D1Database {
  return {
    prepare: () => ({ first: () => Promise.reject(error) }),
  } as unknown as D1Database;
}

describe("/api/health", () => {
  it("answers ok after D1 returns 1", async () => {
    const response = await healthResponse(dbReturning({ ok: 1 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", app: "0509", d1: "ok" });
    expect(Date.parse((body as { timestamp: string }).timestamp)).not.toBeNaN();
  });

  it("answers 503 when D1 returns no row", async () => {
    const response = await healthResponse(dbReturning(null));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error" });
  });

  it("answers 503 when D1 returns a row that is not 1", async () => {
    const response = await healthResponse(dbReturning({ ok: 0 }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error" });
  });

  it("answers 503 when D1 rejects", async () => {
    const response = await healthResponse(dbRejecting(new Error("D1_ERROR")));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error" });
  });
});
