import { afterEach, describe, expect, it, vi } from "vitest";

import { healthResponse } from "../app/lib/observability/health.server";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

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

function dbHanging(): D1Database {
  return {
    prepare: () => ({ first: () => new Promise(() => undefined) }),
  } as unknown as D1Database;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/health", () => {
  it("answers ok after D1 returns 1", async () => {
    const response = await healthResponse(dbReturning({ ok: 1 }), COMMIT);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", app: "0509", d1: "ok", commit: COMMIT });
    expect(Date.parse((body as { timestamp: string }).timestamp)).not.toBeNaN();
  });

  it("answers 503 when D1 returns no row", async () => {
    const response = await healthResponse(dbReturning(null), COMMIT);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error", commit: COMMIT });
  });

  it("answers 503 when D1 returns a row that is not 1", async () => {
    const response = await healthResponse(dbReturning({ ok: 0 }), COMMIT);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error", commit: COMMIT });
  });

  it("answers 503 when D1 rejects", async () => {
    const response = await healthResponse(dbRejecting(new Error("D1_ERROR")), COMMIT);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error", commit: COMMIT });
  });

  it("answers 503 when D1 does not return in time", async () => {
    vi.useFakeTimers();
    const pending = healthResponse(dbHanging(), COMMIT);
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error", app: "0509", d1: "error", commit: COMMIT });
  });

  it("names an empty commit when the version carries no tag", async () => {
    const response = await healthResponse(dbReturning({ ok: 1 }), "");
    await expect(response.json()).resolves.toMatchObject({ status: "ok", commit: "" });
  });
});
