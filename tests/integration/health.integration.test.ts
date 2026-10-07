import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { healthResponse } from "../../app/lib/observability/health.server";

describe("/api/health against local D1", () => {
  it("answers ok after SELECT 1", async () => {
    const response = await healthResponse(env.DB, env.GIT_SHA);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", app: "0509", d1: "ok" });
  });
});
