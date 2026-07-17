import { afterEach, describe, expect, it, vi } from "vitest";

import {
  E2E_AUTH_FAULT_HEADER,
  E2E_AUTH_FAULT_VALUE,
  authSessionUnavailableResponse,
  resolveE2EAuthFaultRequest,
} from "~/lib/auth.server";
import {
  resolveJ6AuthFaultRequest,
  resolveJ6AuthReplayAction,
  resolveJ6AuthReplayMapping,
} from "~/lib/e2e-j6-auth-replay.server";

const viewports = ["375x812", "768x900", "1440x900"] as const;

function request(
  key: string,
  runId: string,
  options: { url?: string; method?: string; cookie?: string; marker?: string; fault?: string } = {},
) {
  return new Request(
    options.url ?? `http://127.0.0.1:43127/api/e2e/auth/replay?idempotencyKey=${key}&runId=${runId}`,
    {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? "f9_e2e_fixture=e2e-starter",
        "x-0509-e2e-test-mode": options.marker ?? "1",
        [E2E_AUTH_FAULT_HEADER]: options.fault ?? E2E_AUTH_FAULT_VALUE,
      },
    },
  );
}

describe("Journey 6 localhost auth outage replay contract", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/e2e-auth.server");
    vi.doUnmock("~/lib/e2e-provider.server");
    vi.doUnmock("~/lib/better-auth.server");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it.each(viewports)("binds exact outage and recovery identities at %s", (viewport) => {
    for (const outcome of ["outage", "recovery"] as const) {
      const key = `e2e-j6-auth-${outcome}-${viewport}`;
      const runId = `e2e-run-j6-auth-${outcome}-${viewport}`;
      expect(resolveJ6AuthReplayAction(key, "e2e-starter", runId)).toBe(
        outcome === "outage" ? "auth_outage" : "auth_recovery",
      );
      expect(resolveJ6AuthReplayMapping(key, "e2e-starter", runId)).toMatchObject({
        outcome,
        userId: "e2e-starter",
        viewport,
      });
    }
  });

  it("fails closed for unknown keys and identity drift", () => {
    expect(resolveJ6AuthReplayAction("e2e-j6-auth-unknown", "e2e-starter", "e2e-run-j6-auth-unknown")).toBeNull();
    expect(resolveJ6AuthReplayAction(
      "e2e-j6-auth-outage-375x812",
      "e2e-agency",
      "e2e-run-j6-auth-outage-375x812",
    )).toBeNull();
    expect(resolveJ6AuthReplayAction(
      "e2e-j6-auth-outage-375x812",
      "e2e-starter",
      "e2e-run-j6-auth-outage-other",
    )).toBeNull();
  });

  it("recognizes only the dedicated marked fault request", () => {
    const key = "e2e-j6-auth-outage-375x812";
    const runId = "e2e-run-j6-auth-outage-375x812";
    const marked = request(key, runId);
    expect(resolveJ6AuthFaultRequest(marked)).toBe(true);
    expect(resolveE2EAuthFaultRequest(marked)).toBe(true);
    expect(resolveJ6AuthFaultRequest(request(key, runId, { fault: "other" }))).toBe(false);
    expect(resolveJ6AuthFaultRequest(request(key, runId, { marker: "0" }))).toBe(false);
    expect(resolveJ6AuthFaultRequest(request(key, runId, { cookie: "f9_e2e_fixture=e2e-agency" }))).toBe(false);
    expect(resolveE2EAuthFaultRequest(request(key, runId, { url: "https://0509.io/app" }))).toBe(false);
  });

  it("keeps the outage response safe and uncached", async () => {
    const response = authSessionUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    const body = await response.text();
    expect(body).toContain("Authentication is temporarily unavailable");
    expect(body).not.toMatch(/cookie|token|D1|SQLITE|stack|error details/i);
  });

  it("fails closed before fixture/provider lookup, then recovers the same fixture session", async () => {
    const fixtureSession = {
      session: {
        expiresAt: "2026-07-15T23:59:59.000Z",
        id: "e2e-session-e2e-starter",
        userId: "e2e-starter",
      },
      user: {
        email: "e2e-starter@example.invalid",
        id: "e2e-starter",
        image: null,
        name: "E2E Starter",
        onboardedAt: null,
      },
    };
    const getE2ETestSession = vi.fn().mockResolvedValue(fixtureSession);
    const getBetterAuthSession = vi.fn().mockRejectedValue(new Error("provider must not run"));
    vi.doMock("~/lib/e2e-auth.server", () => ({
      getE2ETestSession,
      isE2ETestRequestEnabled: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("~/lib/e2e-provider.server", () => ({
      resolveE2EProviderDeny: vi.fn().mockResolvedValue({ enabled: true, failClosed: true }),
    }));
    vi.doMock("~/lib/better-auth.server", () => ({ getBetterAuthSession }));

    const { getCachedOptionalSession, requireSession } = await import("~/lib/auth.server");
    const outageRequest = new Request("http://127.0.0.1:43127/app", {
      headers: {
        cookie: "f9_e2e_fixture=e2e-starter",
        "x-0509-e2e-test-mode": "1",
        [E2E_AUTH_FAULT_HEADER]: E2E_AUTH_FAULT_VALUE,
      },
    });
    const testEnv = { DB: {} as D1Database };
    await expect(getCachedOptionalSession(testEnv, outageRequest)).rejects.toMatchObject({
      name: "AuthSessionUnavailableError",
    });
    let outageResponse: Response | null = null;
    try {
      await requireSession(testEnv, outageRequest);
    } catch (error) {
      outageResponse = error as Response;
    }
    expect(outageResponse?.status).toBe(503);
    expect(outageResponse?.headers.get("cache-control")).toBe("no-store");
    expect(getE2ETestSession).not.toHaveBeenCalled();
    expect(getBetterAuthSession).not.toHaveBeenCalled();

    const recoveryRequest = new Request("http://127.0.0.1:43127/app", {
      headers: {
        cookie: "f9_e2e_fixture=e2e-starter",
        "x-0509-e2e-test-mode": "1",
      },
    });
    const recovered = await requireSession({ DB: {} as D1Database }, recoveryRequest);
    expect(recovered.session.id).toBe(fixtureSession.session.id);
    expect(recovered.user.id).toBe(fixtureSession.user.id);
    expect(getE2ETestSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an absent fixture session null when no outage marker is present", async () => {
    vi.doMock("~/lib/e2e-auth.server", () => ({
      getE2ETestSession: vi.fn().mockResolvedValue(null),
      isE2ETestRequestEnabled: vi.fn().mockResolvedValue(true),
    }));
    const getBetterAuthSession = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/better-auth.server", () => ({ getBetterAuthSession }));

    const { getOptionalSession } = await import("~/lib/auth.server");
    await expect(getOptionalSession({ DB: undefined }, new Request("http://127.0.0.1:43127/app"))).resolves.toBeNull();
    expect(getBetterAuthSession).not.toHaveBeenCalled();
  });
});
