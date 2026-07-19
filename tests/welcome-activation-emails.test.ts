import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/unsubscribe.server");
});

function mockClaimPath(options?: {
  attemptId?: string | null;
  claimUpdatedAt?: string | null;
  secondClaim?: { attemptId: string | null; claimUpdatedAt: string | null };
}) {
  const claimInstantDeliveryAttempt = vi
    .fn()
    .mockResolvedValueOnce({
      attemptId: options?.attemptId === undefined ? "attempt-welcome-1" : options.attemptId,
      claimUpdatedAt: options?.claimUpdatedAt === undefined ? "2026-07-18T12:00:00.000Z" : options.claimUpdatedAt,
      duplicate: null,
      reclaimed: false,
    })
    .mockResolvedValue(
      options?.secondClaim ?? {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: { id: "attempt-welcome-1" },
        reclaimed: false,
      },
    );

  const markInstantDeliveryDispatchStarted = vi
    .fn()
    .mockResolvedValue("2026-07-18T12:00:01.000Z");
  const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);
  const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-legacy");
  const listDeliveryTargets = vi.fn().mockResolvedValue([
    {
      id: "target-1",
      targetValue: "owner@example.com",
      isOptedIn: true,
      optedOutAt: null,
      isPaused: false,
    },
  ]);

  vi.doMock("~/lib/data.server", () => ({
    claimInstantDeliveryAttempt,
    markInstantDeliveryDispatchStarted,
    updateDeliveryAttemptResult,
    createDeliveryAttempt,
    getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
    getDeliveryTargetById: vi.fn(),
    getDeliveryTargetByProviderIdentifier: vi.fn(),
    getWatchlistDeliveryConfig: vi.fn(),
    getWorkspaceDeliveryConfig: vi.fn(),
    legacyWorkspaceDeliveryDefaults: vi.fn(),
    listDeliveryTargets,
    getOldestUserId: vi.fn(),
    getUserDeliveryProfile: vi.fn(),
    getUserIdByEmail: vi.fn(),
    reconcileDeliveryAttemptByProviderMessageId: vi.fn(),
    upsertDeliveryTarget: vi.fn(),
    upsertDigestDelivery: vi.fn(),
  }));

  vi.doMock("~/lib/unsubscribe.server", () => ({
    buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe?u=user-1&t=target-1&sig=abc"),
  }));

  return {
    claimInstantDeliveryAttempt,
    markInstantDeliveryDispatchStarted,
    updateDeliveryAttemptResult,
    listDeliveryTargets,
  };
}

describe("sendWelcomeEmail", () => {
  it("sends exactly once for a user (idempotent claim key)", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_welcome_1" });
    const {
      claimInstantDeliveryAttempt,
      updateDeliveryAttemptResult,
    } = mockClaimPath();

    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      APP_ORIGIN: "https://0509.io",
      UNSUBSCRIBE_SIGNING_SECRET: "test-secret",
    };

    const { sendWelcomeEmail } = await import("~/lib/delivery.server");

    const first = await sendWelcomeEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
    });
    const second = await sendWelcomeEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(emailSend).toHaveBeenCalledTimes(1);

    const claimInput = claimInstantDeliveryAttempt.mock.calls[0]?.[1];
    expect(claimInput.idempotencyKey).toBe("welcome:user-1");
    expect(claimInput.templateName).toBe("welcome");

    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.subject).toMatch(/Welcome/i);
    expect(payload.html).toContain("/app/watchlists");
    expect(payload.headers["List-Unsubscribe"]).toContain("unsubscribe");

    expect(updateDeliveryAttemptResult).toHaveBeenCalled();
  });

  it("does not send when the claim is already owned", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_x" });
    mockClaimPath({ attemptId: null, claimUpdatedAt: null });

    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      APP_ORIGIN: "https://0509.io",
    };

    const { sendWelcomeEmail } = await import("~/lib/delivery.server");
    const result = await sendWelcomeEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
    });

    expect(result).toEqual({ sent: false, reason: "duplicate" });
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe("sendFreeActivationResultEmail", () => {
  it("sends a free activation result with top ads and upgrade line once", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_act_1" });
    const { claimInstantDeliveryAttempt } = mockClaimPath();

    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      APP_ORIGIN: "https://0509.io",
      UNSUBSCRIBE_SIGNING_SECRET: "test-secret",
    };

    const { sendFreeActivationResultEmail } = await import("~/lib/delivery.server");

    const first = await sendFreeActivationResultEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      watchlistId: "wl-1",
      competitorName: "Glossier",
      adsFound: 12,
      topAds: [
        {
          headline: "Soft skin kit",
          body: "Shop the best-sellers",
          creativeImageUrl: "https://cdn.example.com/ad.jpg",
        },
        {
          headline: "New blush",
          body: null,
          creativeImageUrl: null,
        },
      ],
    });
    const second = await sendFreeActivationResultEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      watchlistId: "wl-1",
      competitorName: "Glossier",
      adsFound: 12,
      topAds: [],
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(emailSend).toHaveBeenCalledTimes(1);

    const claimInput = claimInstantDeliveryAttempt.mock.calls[0]?.[1];
    expect(claimInput.idempotencyKey).toBe("activation-result:user-1:wl-1");
    expect(claimInput.templateName).toBe("activation_result");
    expect(claimInput.watchlistId).toBe("wl-1");

    const payload = emailSend.mock.calls[0]?.[0];
    expect(payload.subject).toContain("12 ads");
    expect(payload.subject).toContain("Glossier");
    expect(payload.html).toContain("Soft skin kit");
    expect(payload.html).toContain("https://cdn.example.com/ad.jpg");
    expect(payload.html).toMatch(/Paid plans keep watching/i);
    expect(payload.html).toContain("/app/billing");
    expect(payload.headers["List-Unsubscribe"]).toBeTruthy();
  });

  it("skips send when the recipient has unsubscribed", async () => {
    const emailSend = vi.fn().mockResolvedValue({ messageId: "msg_x" });
    const { listDeliveryTargets, updateDeliveryAttemptResult } = mockClaimPath();
    listDeliveryTargets
      .mockResolvedValueOnce([]) // usable targets empty
      .mockResolvedValueOnce([
        {
          id: "target-1",
          targetValue: "owner@example.com",
          isOptedIn: false,
          optedOutAt: "2026-07-01T00:00:00.000Z",
          isPaused: false,
        },
      ]);

    const env = {
      EMAIL: { send: emailSend },
      EMAIL_FROM_EMAIL: "alerts@0509.io",
      APP_ORIGIN: "https://0509.io",
    };

    const { sendFreeActivationResultEmail } = await import("~/lib/delivery.server");
    const result = await sendFreeActivationResultEmail(env as never, {
      userId: "user-1",
      email: "owner@example.com",
      name: null,
      watchlistId: "wl-1",
      competitorName: "Nike",
      adsFound: 3,
      topAds: [],
    });

    expect(result).toEqual({ sent: false, reason: "unsubscribed" });
    expect(emailSend).not.toHaveBeenCalled();
    expect(updateDeliveryAttemptResult).toHaveBeenCalledWith(
      expect.anything(),
      "attempt-welcome-1",
      expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringMatching(/unsubscribed/i),
      }),
    );
  });
});
