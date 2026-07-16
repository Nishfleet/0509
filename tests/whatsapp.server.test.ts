import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readyEnv = {
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_DELIVERY_ENABLED: "true",
  WHATSAPP_PHONE_NUMBER_ID: "phone-id",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
};

function statusPayload(statuses: Array<{ id: string; status: string; timestamp: unknown }>) {
return { entry: [{ changes: [{ value: { statuses } }] }] };
}

function installSetupClaimHarness(options: {
  fetchMock: ReturnType<typeof vi.fn>;
  failFinalizeOnce?: boolean;
}) {
  let target: Record<string, unknown> | null = null;
  let attempt: Record<string, unknown> | null = null;
  let failFinalizeOnce = options.failFinalizeOnce === true;
  const listDeliveryTargets = vi.fn(async () => (target ? [target] : []));
  const upsertDeliveryTarget = vi.fn(async (_env: unknown, input: Record<string, unknown>) => {
    target = {
      id: "whatsapp-target-1",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      ...input,
    };
    return target;
  });
  const getDeliveryAttemptByIdempotencyKey = vi.fn(async (_env: unknown, key: string) =>
    attempt?.idempotencyKey === key ? { ...attempt } : null,
  );
  const createDeliveryAttempt = vi.fn(async (_env: unknown, input: Record<string, unknown>) => {
    if (attempt) throw new Error("UNIQUE constraint failed: delivery_attempt.idempotency_key");
    const timestamp = String(input.timestamp ?? new Date().toISOString());
    attempt = {
      id: "whatsapp-setup-attempt-1",
      ...input,
      updatedAt: timestamp,
      createdAt: timestamp,
    };
    return attempt.id;
  });
  const updateDeliveryAttemptResult = vi.fn(
    async (_env: unknown, id: string, update: Record<string, unknown>) => {
      if (!attempt || attempt.id !== id) return false;
      if (update.expectedStatus && attempt.status !== update.expectedStatus) return false;
      if (update.expectedWebhookStatus && attempt.webhookStatus !== update.expectedWebhookStatus) {
        return false;
      }
      if (update.expectedUpdatedAt && attempt.updatedAt !== update.expectedUpdatedAt) return false;
      const isFinalization = update.expectedWebhookStatus === "provider_unknown";
      if (isFinalization && failFinalizeOnce) {
        failFinalizeOnce = false;
        throw new Error("injected setup finalization failure");
      }
      attempt = {
        ...attempt,
        ...update,
        updatedAt: String(update.updatedAt ?? new Date().toISOString()),
      };
      return true;
    },
  );
  vi.stubGlobal("fetch", options.fetchMock);
  vi.doMock("~/lib/data.server", () => ({
    createDeliveryAttempt,
    getDeliveryAttemptByIdempotencyKey,
    listDeliveryTargets,
    updateDeliveryAttemptResult,
    upsertDeliveryTarget,
  }));
  return {
    createDeliveryAttempt,
    get attempt() {
      return attempt;
    },
    get target() {
      return target;
    },
    updateDeliveryAttemptResult,
  };
}
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("WhatsApp delivery helpers", () => {
  it("classifies missing instant configuration as a definite pre-provider failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      listDeliveryTargets: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
    }));
    const { sendInstantWhatsApp } = await import("~/lib/whatsapp.server");

    await expect(
      sendInstantWhatsApp({} as never, {
        lane: "customer",
        target: {} as never,
        competitor: "Nykaa",
        shortChange: "Landing page changed.",
        watchlistUrl: "https://0509.io/app/watchlists?watchlist=watch-1",
        provisional: false,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      providerStatusLastSeenAt: null,
      errorMessage: "WhatsApp provider is not configured for this environment.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an instant WhatsApp transport exception provider-unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("accepted then connection reset")));
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      listDeliveryTargets: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
    }));
    const { sendInstantWhatsApp } = await import("~/lib/whatsapp.server");

    await expect(
      sendInstantWhatsApp(readyEnv as never, {
        lane: "customer",
        target: {
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          isValidated: true,
          validationStatus: "validated",
          templateEligible: true,
          targetValue: "919876543210",
        } as never,
        competitor: "Nykaa",
        shortChange: "Landing page changed.",
        watchlistUrl: "https://0509.io/app/watchlists?watchlist=watch-1",
        provisional: false,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
    });
  });

  it("does not claim Meta accepted an instant message without a message id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ messages: [] })));
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      listDeliveryTargets: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
    }));
    const { sendInstantWhatsApp } = await import("~/lib/whatsapp.server");

    await expect(
      sendInstantWhatsApp(readyEnv as never, {
        lane: "customer",
        target: {
          isOptedIn: true,
          isPaused: false,
          optedOutAt: null,
          isValidated: true,
          validationStatus: "validated",
          templateEligible: true,
          targetValue: "919876543210",
        } as never,
        competitor: "Nykaa",
        shortChange: "Landing page changed.",
        watchlistUrl: "https://0509.io/app/watchlists?watchlist=watch-1",
        provisional: false,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      errorMessage: "WhatsApp returned success without a message id; acceptance is unverified.",
    });
  });

  it("classifies missing digest configuration as a definite pre-dispatch failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      listDeliveryTargets: vi.fn(),
      upsertDeliveryTarget: vi.fn(),
    }));
    const { sendDigestWhatsApp } = await import("~/lib/whatsapp.server");

    await expect(
      sendDigestWhatsApp({} as never, {
        lane: "customer",
        target: {} as never,
        itemCount: 1,
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-08T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      providerStatusLastSeenAt: null,
      errorMessage: "WhatsApp provider is not configured for this environment.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes WhatsApp recipients to international digits", async () => {
    const { normalizeWhatsAppRecipient } = await import("~/lib/whatsapp.server");

    expect(normalizeWhatsAppRecipient("+91 98765 43210")).toBe("919876543210");
    expect(normalizeWhatsAppRecipient("1 (555) 123-4567")).toBe("15551234567");
    expect(() => normalizeWhatsAppRecipient("555")).toThrow(Response);
  });

it("keeps newer delivered WhatsApp proof over an older failed update in the same payload", async () => {
const { extractWhatsAppWebhookStatusUpdates } = await import("~/lib/whatsapp.server");
const updates = extractWhatsAppWebhookStatusUpdates(statusPayload([
{ id: "wamid.setup-1", status: "delivered", timestamp: "1780000001" },
{ id: "wamid.setup-1", status: "failed", timestamp: "1780000000" },
]));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      providerMessageId: "wamid.setup-1",
      rawProviderStatus: "delivered",
      webhookStatus: "delivered",
      status: "sent",
});
});
it.each([
["missing", undefined], ["nonnumeric", "not-a-time"], ["empty", ""], ["negative", "-1"],
["unsafe", "9007199254740992"], ["invalid date", "8640000000001"],
["coerced number", 1713490000],
])("drops an explicit %s provider timestamp", async (_label, timestamp) => {
const { extractWhatsAppWebhookStatusUpdates } = await import("~/lib/whatsapp.server");
expect(extractWhatsAppWebhookStatusUpdates(statusPayload([
{ id: "wamid.invalid", status: "failed", timestamp },
]))).toEqual([]);
});
it("keeps valid duplicate proof while dropping malformed statuses in the same payload", async () => {
const { extractWhatsAppWebhookStatusUpdates } = await import("~/lib/whatsapp.server");
const updates = extractWhatsAppWebhookStatusUpdates(statusPayload([
{ id: "wamid.same", status: "failed", timestamp: "invalid" },
{ id: "wamid.same", status: "delivered", timestamp: "1780000001" },
{ id: "wamid.other", status: "read", timestamp: "1780000002" },
{ id: "wamid.drop", status: "failed", timestamp: "-1" },
]));
expect(updates.map(({ providerMessageId, rawProviderStatus }) =>
[providerMessageId, rawProviderStatus])).toEqual([
["wamid.same", "delivered"], ["wamid.other", "read"],
]);
expect(updates[0]?.providerStatusLastSeenAt).toBe("2026-05-28T20:26:41.000Z");
});

it("persists an ambiguous setup claim and never resends it automatically", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("accepted then connection reset"));
  const state = installSetupClaimHarness({ fetchMock });
  const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
  const input = {
    userId: "user-1",
    targetValue: "+91 98765 43210",
    explicitOptIn: true,
  };

  await expect(saveWhatsAppDeliveryTarget(readyEnv as never, input)).rejects.toThrow(Response);
  await expect(saveWhatsAppDeliveryTarget(readyEnv as never, input)).rejects.toThrow(Response);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.createDeliveryAttempt).toHaveBeenCalledTimes(1);
  expect(state.attempt).toMatchObject({
    status: "failed",
    webhookStatus: "provider_unknown",
    providerMessageId: null,
    idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:initial",
  });
});

it("lets concurrent setup requests cross the Meta boundary at most once", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({ messages: [{ id: "wamid.setup-concurrent" }] }),
  );
  const state = installSetupClaimHarness({ fetchMock });
  const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
  const input = {
    userId: "user-1",
    targetValue: "+91 98765 43210",
    explicitOptIn: true,
  };

  await expect(Promise.all([
    saveWhatsAppDeliveryTarget(readyEnv as never, input),
    saveWhatsAppDeliveryTarget(readyEnv as never, input),
  ])).resolves.toHaveLength(2);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.attempt).toMatchObject({
    status: "sent",
    webhookStatus: "pending",
    providerMessageId: "wamid.setup-concurrent",
  });
});

it("does not resend when setup acceptance is followed by local finalization failure", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({ messages: [{ id: "wamid.setup-finalize" }] }),
  );
  const state = installSetupClaimHarness({ fetchMock, failFinalizeOnce: true });
  const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
  const input = {
    userId: "user-1",
    targetValue: "+91 98765 43210",
    explicitOptIn: true,
  };

  await expect(saveWhatsAppDeliveryTarget(readyEnv as never, input)).rejects.toThrow(
    "injected setup finalization failure",
  );
  await expect(saveWhatsAppDeliveryTarget(readyEnv as never, input)).rejects.toThrow(Response);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.attempt).toMatchObject({ status: "pending", webhookStatus: "provider_unknown" });
});

  it("saves a pending WhatsApp target and records the setup validation attempt", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-1");
    const listDeliveryTargets = vi.fn().mockResolvedValue([]);
    const upsertDeliveryTarget = vi.fn().mockImplementation(async (_env, target) => ({
      id: "whatsapp-target-1",
      ...target,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        messages: [{ id: "wamid.setup-1" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      listDeliveryTargets,
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
    const target = await saveWhatsAppDeliveryTarget(readyEnv as never, {
      userId: "user-1",
      targetValue: "+91 98765 43210",
      name: "Founder phone",
      explicitOptIn: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v23.0/phone-id/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer wa-token",
        }),
      }),
    );
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        channel: "whatsapp",
        targetValue: "919876543210",
        validationStatus: "pending",
        isValidated: false,
        isOptedIn: true,
        optInSource: "manual_whatsapp_setup",
        templateEligible: false,
        providerIdentifier: "wamid.setup-1",
        metadata: expect.objectContaining({
          displayName: "Founder phone",
          validationTemplateName: "proof_digest_customer_v1",
          validationProviderMessageId: "wamid.setup-1",
          validationWebhookStatus: "pending",
        }),
      }),
    );
    expect(createDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        deliveryTargetId: "whatsapp-target-1",
        lane: "customer",
        channel: "whatsapp",
        provider: "whatsapp_cloud_api",
        status: "pending",
        webhookStatus: "pending",
        targetValue: "919876543210",
        providerMessageId: null,
        providerStatusLastSeenAt: null,
        templateName: "proof_digest_customer_v1",
        payloadSnapshot: expect.objectContaining({
          kind: "whatsapp_setup_validation",
          validationGeneration: "initial",
        }),
        idempotencyKey: "whatsapp_setup_validation:user-1:919876543210:initial",
      }),
    );
    expect(target?.targetValue).toBe("919876543210");
  });

  it("preserves existing WhatsApp delivery proof when revalidating the same target", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-2");
    const listDeliveryTargets = vi.fn().mockResolvedValue([
      {
        id: "whatsapp-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "whatsapp",
        targetValue: "919876543210",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_whatsapp_setup",
        optedInAt: "2026-06-06T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-existing",
        providerIdentifier: "wamid.old",
        metadata: {
          displayName: "Founder phone",
        },
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T01:00:00.000Z",
      },
    ]);
    const upsertDeliveryTarget = vi.fn().mockImplementation(async (_env, target) => ({
      id: "whatsapp-target-1",
      ...target,
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          messages: [{ id: "wamid.setup-2" }],
        }),
      ),
    );
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      listDeliveryTargets,
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
    await saveWhatsAppDeliveryTarget(readyEnv as never, {
      userId: "user-1",
      targetValue: "+91 98765 43210",
      name: "Founder phone",
      explicitOptIn: true,
    });

    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationStatus: "validated",
        isValidated: true,
        optedInAt: expect.any(String),
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-existing",
      }),
    );
  });

  it("keeps opted-out WhatsApp reconnects pending until the new setup is delivered", async () => {
    const createDeliveryAttempt = vi.fn().mockResolvedValue("attempt-3");
    const listDeliveryTargets = vi.fn().mockResolvedValue([
      {
        id: "whatsapp-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "whatsapp",
        targetValue: "919876543210",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_whatsapp_setup",
        optedInAt: "2026-06-06T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: "2026-06-06T02:00:00.000Z",
        templateEligible: true,
        lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-existing",
        providerIdentifier: "wamid.old",
        metadata: {
          displayName: "Founder phone",
        },
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T01:00:00.000Z",
      },
    ]);
    const upsertDeliveryTarget = vi.fn().mockImplementation(async (_env, target) => ({
      id: "whatsapp-target-1",
      ...target,
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          messages: [{ id: "wamid.setup-3" }],
        }),
      ),
    );
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      getDeliveryAttemptByIdempotencyKey: vi.fn().mockResolvedValue(null),
      listDeliveryTargets,
      updateDeliveryAttemptResult: vi.fn().mockResolvedValue(true),
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");
    await saveWhatsAppDeliveryTarget(readyEnv as never, {
      userId: "user-1",
      targetValue: "+91 98765 43210",
      name: "Founder phone",
      explicitOptIn: true,
    });

    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationStatus: "pending",
        isValidated: false,
        templateEligible: false,
        optedOutAt: null,
        lastSuccessfulDeliveryAt: "2026-06-06T01:00:00.000Z",
        lastSuccessfulAttemptId: "attempt-existing",
      }),
    );
  });

  it("does not save a WhatsApp target without explicit opt-in", async () => {
    const upsertDeliveryTarget = vi.fn();
    vi.stubGlobal("fetch", vi.fn());
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt: vi.fn(),
      listDeliveryTargets: vi.fn(),
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");

    await expect(
      saveWhatsAppDeliveryTarget(readyEnv as never, {
        userId: "user-1",
        targetValue: "+91 98765 43210",
        explicitOptIn: false,
      }),
    ).rejects.toThrow(Response);
    expect(fetch).not.toHaveBeenCalled();
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("does not save a WhatsApp target when the setup template is rejected", async () => {
    const state = installSetupClaimHarness({
      fetchMock: vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              message: "Template does not exist.",
            },
          },
          { status: 400 },
        ),
      ),
    });

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");

    await expect(
      saveWhatsAppDeliveryTarget(readyEnv as never, {
        userId: "user-1",
        targetValue: "+91 98765 43210",
        explicitOptIn: true,
      }),
    ).rejects.toThrow(Response);
    expect(state.createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(state.target).toMatchObject({ validationStatus: "pending", isValidated: false });
    expect(state.attempt).toMatchObject({ status: "failed", webhookStatus: "failed" });
  });

  it("does not save a WhatsApp target when Meta omits the setup message id", async () => {
    const state = installSetupClaimHarness({
      fetchMock: vi.fn().mockResolvedValue(
        Response.json({
          messages: [],
        }),
      ),
    });

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");

    await expect(
      saveWhatsAppDeliveryTarget(readyEnv as never, {
        userId: "user-1",
        targetValue: "+91 98765 43210",
        explicitOptIn: true,
      }),
    ).rejects.toThrow(Response);
    expect(state.createDeliveryAttempt).toHaveBeenCalledTimes(1);
    expect(state.target).toMatchObject({ validationStatus: "pending", isValidated: false });
    expect(state.attempt).toMatchObject({
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
    });
  });
});
