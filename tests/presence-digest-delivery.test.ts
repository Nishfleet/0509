import { afterEach, describe, expect, it, vi } from "vitest";

const target = {
  id: "presence-email-target",
  userId: "user-1",
  watchlistId: null,
  channel: "email" as const,
  targetValue: "owner@example.com",
  validationStatus: "validated" as const,
  isValidated: true,
  isOptedIn: true,
  optInSource: "account_email",
  optedInAt: "2026-07-30T00:00:00.000Z",
  isPaused: false,
  pausedAt: null,
  optedOutAt: null,
  templateEligible: false,
  lastSuccessfulDeliveryAt: null,
  lastSuccessfulAttemptId: null,
  providerIdentifier: null,
  metadata: {},
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

async function loadSender(input: {
  provisionedTarget: typeof target | null;
  dispatchStartedAt?: string | null;
}) {
  const sendCloudflareEmail = vi.fn().mockResolvedValue({
    provider: "cloudflare",
    status: "sent",
    webhookStatus: "provider_unknown",
    providerMessageId: "message-1",
    providerStatusLastSeenAt: "2026-07-30T00:00:03.000Z",
    errorMessage: null,
    deliveredAt: null,
  });
  const claimInstantDeliveryAttempt = vi.fn().mockResolvedValue({
    attemptId: "presence-attempt-1",
    claimUpdatedAt: "2026-07-30T00:00:01.000Z",
    duplicate: null,
    reclaimed: false,
  });
  const markInstantDeliveryDispatchStarted = vi
    .fn()
    .mockResolvedValue(
      input.dispatchStartedAt === undefined
        ? "2026-07-30T00:00:02.000Z"
        : input.dispatchStartedAt,
    );
  const updateDeliveryAttemptResult = vi.fn().mockResolvedValue(true);

  vi.doMock("~/lib/data.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/data.server")>();
    return {
      ...actual,
      createDeliveryAttempt: vi.fn().mockResolvedValue("legacy-attempt"),
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      provisionVerifiedAccountEmailTargetIfUnsuppressed: vi
        .fn()
        .mockResolvedValue(input.provisionedTarget),
      updateDeliveryAttemptResult,
    };
  });
  vi.doMock("~/lib/data/delivery-records-attempts.server", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("~/lib/data/delivery-records-attempts.server")>();
    return {
      ...actual,
      claimInstantDeliveryAttempt,
      markInstantDeliveryDispatchStarted,
    };
  });
  vi.doMock("~/lib/delivery-email-core.server", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("~/lib/delivery-email-core.server")>();
    return {
      ...actual,
      sendCloudflareEmail,
    };
  });
  vi.doMock("~/lib/unsubscribe.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/unsubscribe.server")>();
    return {
      ...actual,
      buildUnsubscribeUrl: vi.fn().mockResolvedValue("https://0509.io/unsubscribe/token"),
    };
  });

  const { sendPresenceDigestEmail } = await import("~/lib/delivery.server");
  return {
    claimInstantDeliveryAttempt,
    markInstantDeliveryDispatchStarted,
    sendCloudflareEmail,
    sendPresenceDigestEmail,
    updateDeliveryAttemptResult,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/data/delivery-records-attempts.server");
  vi.doUnmock("~/lib/delivery-email-core.server");
  vi.doUnmock("~/lib/unsubscribe.server");
});

describe("presence digest email delivery", () => {
  // Relocated from delivery.server.test.ts. That file's harness has no DB and
  // mocks createDeliveryAttempt, which suited main's send-then-record design;
  // this branch claims a durable attempt first, so the assertion only runs
  // meaningfully against the mocks below.
  it("records provider acceptance without claiming recipient delivery", async () => {
    const loaded = await loadSender({ provisionedTarget: target });

    await expect(
      loaded.sendPresenceDigestEmail({ DB: {} } as never, {
        userId: "user-1",
        email: "owner@example.com",
        subject: "Presence brief",
        lines: ["Competitor — New result"],
        idempotencyKey: "presence-digest:user-1:2026-07-30",
      }),
      // The provider accepted it, but webhookStatus stays provider_unknown, so
      // recipient delivery is explicitly not claimed.
    ).resolves.toEqual({ accepted: true, delivered: false });
    expect(loaded.sendCloudflareEmail).toHaveBeenCalledTimes(1);
  });

  it("fails closed when account-wide suppression prevents target provisioning", async () => {
    const loaded = await loadSender({ provisionedTarget: null });

    await expect(
      loaded.sendPresenceDigestEmail(
        { DB: {} } as never,
        {
          userId: "user-1",
          email: "owner@example.com",
          subject: "Presence brief",
          lines: ["Competitor — New result"],
          idempotencyKey: "presence-digest:user-1:2026-07-30",
        },
      ),
    ).resolves.toEqual({ accepted: false, delivered: false });
    expect(loaded.claimInstantDeliveryAttempt).not.toHaveBeenCalled();
    expect(loaded.sendCloudflareEmail).not.toHaveBeenCalled();
  });

  it("does not call the provider when unsubscribe wins the dispatch CAS", async () => {
    const loaded = await loadSender({
      provisionedTarget: target,
      dispatchStartedAt: null,
    });

    await expect(
      loaded.sendPresenceDigestEmail(
        { DB: {} } as never,
        {
          userId: "user-1",
          email: "owner@example.com",
          subject: "Presence brief",
          lines: ["Competitor — New result"],
          idempotencyKey: "presence-digest:user-1:2026-07-30",
        },
      ),
    ).resolves.toEqual({ accepted: false, delivered: false });
    expect(loaded.claimInstantDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deliveryTargetId: target.id,
        idempotencyKey: "presence-digest:user-1:2026-07-30",
      }),
    );
    expect(loaded.markInstantDeliveryDispatchStarted).toHaveBeenCalled();
    expect(loaded.sendCloudflareEmail).not.toHaveBeenCalled();
  });
});
