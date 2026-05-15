import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function createDbWithTarget() {
  return {
    prepare() {
      return {
        async all<T>() {
          return {
            results: [
              {
                user_id: "user-1",
                email: "owner@example.com",
                name: "Owner",
                watchlist_id: "watch-1",
                watchlist_name: "Nykaa watch",
                target_label: "Nykaa",
              },
            ] as T[],
          };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/delivery.server");
});

describe("launch readiness canary route", () => {
  it("hides the endpoint without the canary token", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
      })),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");

    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.in/api/launch-readiness/canary", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("creates fresh monitoring, proof, digest, and delivery signals", async () => {
    const createWatchlistRun = vi.fn().mockResolvedValue("run-1");
    const finishWatchlistRun = vi.fn().mockResolvedValue(undefined);
    const upsertProofTarget = vi.fn().mockResolvedValue({ id: "proof-target-1" });
    const createProofCapture = vi.fn().mockResolvedValue("proof-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-1");
    const createDigestRun = vi.fn().mockResolvedValue("digest-1");
    const clearDigestItems = vi.fn().mockResolvedValue(undefined);
    const addDigestItem = vi.fn().mockResolvedValue(undefined);
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          channel: "email",
          status: "sent",
          targetValue: "owner@example.com",
          providerMessageId: "email-1",
          errorMessage: null,
          deliveredAt: new Date().toISOString(),
        },
      ],
    });

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem,
      clearDigestItems,
      createDigestRun,
      createProofCapture,
      createWatchEvent,
      createWatchlistRun,
      finishWatchlistRun,
      upsertProofTarget,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runId: "run-1",
      proofCaptureId: "proof-1",
      digestRunId: "digest-1",
      delivery: {
        attempts: 1,
      },
    });
    expect(createWatchlistRun).toHaveBeenCalledWith(expect.anything(), "watch-1", "manual", null, 1);
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proofTargetId: "proof-target-1",
        status: "succeeded",
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        lane: "internal",
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
      }),
    );
  });

  it("fails when delivery is attempted but not sent", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        DB: createDbWithTarget(),
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn().mockResolvedValue(undefined),
      clearDigestItems: vi.fn().mockResolvedValue(undefined),
      createDigestRun: vi.fn().mockResolvedValue("digest-1"),
      createProofCapture: vi.fn().mockResolvedValue("proof-1"),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn().mockResolvedValue(undefined),
      upsertProofTarget: vi.fn().mockResolvedValue({ id: "proof-target-1" }),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest: vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [
          {
            channel: "email",
            status: "failed",
            targetValue: "owner@example.com",
            providerMessageId: null,
            errorMessage: "domain is not verified",
            deliveredAt: null,
          },
        ],
      }),
    }));

    const { action } = await import("~/routes/api.launch-readiness.canary");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/launch-readiness/canary", {
        method: "POST",
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      delivery: {
        attempts: 1,
        details: [
          {
            status: "failed",
          },
        ],
      },
    });
  });
});
