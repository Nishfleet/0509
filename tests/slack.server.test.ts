import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  META_TOKEN_ENCRYPTION_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
};

function fakeSlackWebhookUrl() {
  return new URL(["services", "TSTUB", "BSTUB", "short"].join("/"), "https://hooks.slack.com/").toString();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Slack delivery helpers", () => {
  it("validates incoming webhook URLs", async () => {
    const { normalizeSlackWebhookUrl } = await import("~/lib/slack.server");

    expect(normalizeSlackWebhookUrl(fakeSlackWebhookUrl())).toBe(fakeSlackWebhookUrl());
    expect(() => normalizeSlackWebhookUrl("https://example.com/services/T/B/C")).toThrow(Response);
  });

  it("saves Slack webhook targets without storing the raw URL as the target value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const upsertDeliveryTarget = vi.fn().mockImplementation(async (_env, target) => ({
      id: "slack-target-1",
      ...target,
      metadata: target.metadata,
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn(),
      upsertDeliveryTarget,
    }));

    const { saveSlackWebhookTarget } = await import("~/lib/slack.server");
    const webhookUrl = fakeSlackWebhookUrl();
    const target = await saveSlackWebhookTarget(env as never, {
      userId: "user-1",
      webhookUrl,
      name: "Growth alerts",
    }, {
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        channel: "slack",
        targetValue: expect.stringMatching(/^slack:/),
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
      }),
    );
    expect(target?.targetValue).not.toContain(webhookUrl);
    expect(String(target?.metadata.encryptedWebhookUrl)).not.toContain(webhookUrl);
    expect(target?.metadata.displayName).toBe("Growth alerts");
  });

  it("does not save Slack webhook targets when the setup test fails", async () => {
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn(),
      upsertDeliveryTarget,
    }));

    const { saveSlackWebhookTarget } = await import("~/lib/slack.server");

    await expect(
      saveSlackWebhookTarget(
        env as never,
        {
          userId: "user-1",
          webhookUrl: fakeSlackWebhookUrl(),
          name: "Growth alerts",
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(new Response("invalid_payload", { status: 400 })),
        },
      ),
    ).rejects.toThrow(Response);
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses an owned Slack target by id", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      id: "slack-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "slack",
      targetValue: "slack:abc",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "manual_slack_webhook",
      optedInAt: "2026-06-06T00:00:00.000Z",
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: true,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: "abc",
      metadata: {
        displayName: "Growth alerts",
        encryptedWebhookUrl: "v1:iv:ciphertext",
      },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    });
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { pauseSlackWebhookTarget } = await import("~/lib/slack.server");
    const paused = await pauseSlackWebhookTarget(env as never, {
      userId: "user-1",
      targetId: "slack-target-1",
    });

    expect(paused).toBe(true);
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "slack",
        targetValue: "slack:abc",
        isPaused: true,
      }),
    );
  });

  it("resumes an owned paused Slack target by id", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue({
      id: "slack-target-1",
      userId: "user-1",
      watchlistId: null,
      channel: "slack",
      targetValue: "slack:abc",
      validationStatus: "validated",
      isValidated: true,
      isOptedIn: true,
      optInSource: "manual_slack_webhook",
      optedInAt: "2026-06-06T00:00:00.000Z",
      isPaused: true,
      pausedAt: "2026-06-06T01:00:00.000Z",
      optedOutAt: null,
      templateEligible: true,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: "abc",
      metadata: {
        displayName: "Growth alerts",
        encryptedWebhookUrl: "v1:iv:ciphertext",
      },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    });
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { resumeSlackWebhookTarget } = await import("~/lib/slack.server");
    const resumed = await resumeSlackWebhookTarget(env as never, {
      userId: "user-1",
      targetId: "slack-target-1",
    });

    expect(resumed).toBe(true);
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "slack",
        targetValue: "slack:abc",
        isPaused: false,
        pausedAt: null,
      }),
    );
  });
});

describe("sendSlackWebhookMessage", () => {
  it("keeps transport-ambiguous Slack failures terminal instead of retrying them", async () => {
    const { sendSlackWebhookUrl } = await import("~/lib/slack-webhook.server");
    const result = await sendSlackWebhookUrl(
      fakeSlackWebhookUrl(),
      { text: "Five to Nine alert" },
      { fetchImpl: vi.fn().mockRejectedValue(new Error("connection reset after write")) },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
    });
  });

  it("keeps a successful Slack response terminal when its body cannot be read", async () => {
    const { sendSlackWebhookUrl } = await import("~/lib/slack-webhook.server");
    const result = await sendSlackWebhookUrl(
      fakeSlackWebhookUrl(),
      { text: "Five to Nine alert" },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("response stream reset"));
              },
            }),
            { status: 200 },
          ),
        ),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
    });
  });

  it("posts JSON to the decrypted webhook URL and marks the send delivered", async () => {
    const { encryptCredential } = await import("~/lib/credential-crypto.server");
    const { sendSlackWebhookMessage } = await import("~/lib/slack-webhook.server");
    const webhookUrl = fakeSlackWebhookUrl();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlackWebhookMessage(
      env as never,
      {
        id: "slack-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "slack",
        targetValue: "slack:abc",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_slack_webhook",
        optedInAt: "2026-06-06T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: "abc",
        metadata: {
          encryptedWebhookUrl: await encryptCredential(env as never, webhookUrl),
        },
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
      {
        text: "Five to Nine digest",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "Five to Nine digest" }),
      }),
    );
    expect(result).toMatchObject({
      provider: "slack_incoming_webhook",
      status: "sent",
      webhookStatus: "delivered",
      errorMessage: null,
    });
  });

  it("returns Slack error text for failed webhook responses", async () => {
    const { encryptCredential } = await import("~/lib/credential-crypto.server");
    const { sendSlackWebhookMessage } = await import("~/lib/slack-webhook.server");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid_payload", { status: 400 })));

    const result = await sendSlackWebhookMessage(
      env as never,
      {
        id: "slack-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "slack",
        targetValue: "slack:abc",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_slack_webhook",
        optedInAt: "2026-06-06T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: "abc",
        metadata: {
          encryptedWebhookUrl: await encryptCredential(env as never, fakeSlackWebhookUrl()),
        },
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
      {
        text: "Five to Nine digest",
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      errorMessage: "Slack send failed: invalid_payload.",
    });
  });

  it("bounds oversized Slack webhook error bodies", async () => {
    const { encryptCredential } = await import("~/lib/credential-crypto.server");
    const { sendSlackWebhookMessage } = await import("~/lib/slack-webhook.server");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("x".repeat(20_000), { status: 500 }),
    ));

    const result = await sendSlackWebhookMessage(
      env as never,
      {
        id: "slack-target-1",
        userId: "user-1",
        watchlistId: null,
        channel: "slack",
        targetValue: "slack:abc",
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
        optInSource: "manual_slack_webhook",
        optedInAt: "2026-06-06T00:00:00.000Z",
        isPaused: false,
        pausedAt: null,
        optedOutAt: null,
        templateEligible: true,
        lastSuccessfulDeliveryAt: null,
        lastSuccessfulAttemptId: null,
        providerIdentifier: "abc",
        metadata: {
          encryptedWebhookUrl: await encryptCredential(env as never, fakeSlackWebhookUrl()),
        },
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
      {
        text: "Five to Nine digest",
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      errorMessage: "Slack send failed: Slack returned HTTP 500.",
    });
  });
});
