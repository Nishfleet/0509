import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readyEnv = {
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_DELIVERY_ENABLED: "true",
  WHATSAPP_PHONE_NUMBER_ID: "phone-id",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("WhatsApp delivery helpers", () => {
  it("keeps transport-ambiguous WhatsApp failures pending instead of retrying them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset after write")));
    const { sendInstantWhatsApp } = await import("~/lib/whatsapp.server");
    const result = await sendInstantWhatsApp(readyEnv as never, {
      lane: "customer",
      target: {
        id: "whatsapp-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "whatsapp",
        targetValue: "919876543210",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_whatsapp_setup",
        optedInAt: "2026-07-14T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: "wamid.setup-1",
        metadata: {},
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      competitor: "Nykaa",
      shortChange: "New offer",
      watchlistUrl: "https://0509.io/app/watchlists/watch-1",
      provisional: false,
    });

    expect(result).toMatchObject({
      status: "pending",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      templateName: "confirmed_instant_customer_v1",
    });
  });

  it("normalizes WhatsApp recipients to international digits", async () => {
    const { normalizeWhatsAppRecipient } = await import("~/lib/whatsapp.server");

    expect(normalizeWhatsAppRecipient("+91 98765 43210")).toBe("919876543210");
    expect(normalizeWhatsAppRecipient("1 (555) 123-4567")).toBe("15551234567");
    expect(() => normalizeWhatsAppRecipient("555")).toThrow(Response);
  });

  it("keeps delivered WhatsApp webhook proof over sent-only updates", async () => {
    const { extractWhatsAppWebhookStatusUpdates } = await import("~/lib/whatsapp.server");

    const updates = extractWhatsAppWebhookStatusUpdates({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.setup-1",
                    status: "delivered",
                    timestamp: "1780000000",
                  },
                  {
                    id: "wamid.setup-1",
                    status: "sent",
                    timestamp: "1780000001",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      providerMessageId: "wamid.setup-1",
      rawProviderStatus: "delivered",
      webhookStatus: "delivered",
      status: "sent",
    });
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
      listDeliveryTargets,
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
        providerMessageId: "wamid.setup-1",
        templateName: "proof_digest_customer_v1",
        payloadSnapshot: expect.objectContaining({
          kind: "whatsapp_setup_validation",
        }),
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
      listDeliveryTargets,
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
      listDeliveryTargets,
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
    const createDeliveryAttempt = vi.fn();
    const listDeliveryTargets = vi.fn().mockResolvedValue([]);
    const upsertDeliveryTarget = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              message: "Template does not exist.",
            },
          },
          { status: 400 },
        ),
      ),
    );
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      listDeliveryTargets,
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");

    await expect(
      saveWhatsAppDeliveryTarget(readyEnv as never, {
        userId: "user-1",
        targetValue: "+91 98765 43210",
        explicitOptIn: true,
      }),
    ).rejects.toThrow(Response);
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("does not save a WhatsApp target when Meta omits the setup message id", async () => {
    const createDeliveryAttempt = vi.fn();
    const listDeliveryTargets = vi.fn().mockResolvedValue([]);
    const upsertDeliveryTarget = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          messages: [],
        }),
      ),
    );
    vi.doMock("~/lib/data.server", () => ({
      createDeliveryAttempt,
      listDeliveryTargets,
      upsertDeliveryTarget,
    }));

    const { saveWhatsAppDeliveryTarget } = await import("~/lib/whatsapp.server");

    await expect(
      saveWhatsAppDeliveryTarget(readyEnv as never, {
        userId: "user-1",
        targetValue: "+91 98765 43210",
        explicitOptIn: true,
      }),
    ).rejects.toThrow(Response);
    expect(createDeliveryAttempt).not.toHaveBeenCalled();
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});
