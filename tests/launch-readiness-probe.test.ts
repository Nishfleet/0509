import { describe, expect, it, vi } from "vitest";

import { checkLaunchReadinessEndpoint } from "../scripts/prod-canary.lib.mjs";

describe("checkLaunchReadinessEndpoint", () => {
  it("synthesizes an honest blocker when the route 500s with a non-JSON body (issue #3392)", async () => {
    // Before #3392 a thrown route error journaled blockers:[] — a real outage
    // disguised as "0 blockers" in the Gate C verdict.
    const result = await checkLaunchReadinessEndpoint({
      canaryBypassToken: "secret-token",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("<html><body>Internal Server Error</body></html>", {
          status: 500,
        }),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.blockers).toEqual(["launch_readiness_http_500"]);
    expect(result.signals).toBeNull();
    expect(result.metaAdsBeta).toBeNull();
  });

  it("carries the route's singular blocker field when a 503 names one", async () => {
    const result = await checkLaunchReadinessEndpoint({
      canaryBypassToken: "secret-token",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json(
          {
            ok: false,
            blocker: "missing_db",
            message: "D1 is not configured, so launch readiness signals cannot be checked.",
          },
          { status: 503 },
        ),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.blockers).toEqual(["missing_db"]);
  });

  it("keeps the route's declared blockers when they are present", async () => {
    const result = await checkLaunchReadinessEndpoint({
      canaryBypassToken: "secret-token",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json(
          {
            ok: false,
            blocker: "launch_readiness_signals_failed",
            blockers: ["launch_readiness_signals_failed"],
          },
          { status: 503 },
        ),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(["launch_readiness_signals_failed"]);
  });

  it("synthesizes a blocker when a non-ok response declares none", async () => {
    const result = await checkLaunchReadinessEndpoint({
      canaryBypassToken: "secret-token",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json({ ok: false }, { status: 503 }),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(["launch_readiness_http_503"]);
  });

  it("keeps blockers empty only on a healthy 200 response", async () => {
    const result = await checkLaunchReadinessEndpoint({
      canaryBypassToken: "secret-token",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json({ ok: true, blockers: [], signals: {}, metaAdsBeta: null }),
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
