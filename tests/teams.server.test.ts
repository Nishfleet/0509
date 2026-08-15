import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeliveryTargetRecord } from "~/lib/types";

const env = {
  META_TOKEN_ENCRYPTION_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
};

function fakeTeamsWebhookUrl() {
  return new URL(
    ["webhookb2", "uuid@tenant", "IncomingWebhook", "uuid", "secret"].join("/"),
    "https://acme.webhook.office.com/",
  ).toString();
}

function fakeLegacyTeamsWebhookUrl() {
  return new URL(
    ["webhook", "uuid@tenant", "IncomingWebhook", "uuid", "secret"].join("/"),
    "https://outlook.office.com/",
  ).toString();
}

function teamsTarget(overrides: Partial<DeliveryTargetRecord> = {}): DeliveryTargetRecord {
  return {
    id: "teams-target-1",
    userId: "user-1",
    watchlistId: null,
    channel: "teams",
    targetValue: "teams:abc",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "manual_teams_webhook",
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
    ...overrides,
  } satisfies DeliveryTargetRecord;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Teams delivery helpers", () => {
  it("validates current and legacy Teams incoming webhook URLs", async () => {
    const { normalizeTeamsWebhookUrl } = await import("~/lib/teams.server");

    expect(normalizeTeamsWebhookUrl(fakeTeamsWebhookUrl())).toBe(fakeTeamsWebhookUrl());
    expect(normalizeTeamsWebhookUrl(fakeLegacyTeamsWebhookUrl())).toBe(fakeLegacyTeamsWebhookUrl());
    expect(() => normalizeTeamsWebhookUrl("https://example.com/webhookb2/a/b/c")).toThrow(Response);
    expect(() => normalizeTeamsWebhookUrl("https://hooks.slack.com/services/T/B/C")).toThrow(Response);
    expect(() => normalizeTeamsWebhookUrl("http://acme.webhook.office.com/webhookb2/a/b/c")).toThrow(Response);
    // Workflow URLs fail closed: no accepted shape, nothing can be misread as
    // a confirmed delivery.
    expect(() =>
      normalizeTeamsWebhookUrl("https://prod-01.westus.logic.azure.com/workflows/x/triggers/manual/paths/invoke"),
    ).toThrow(Response);
  });

  it("saves Teams webhook targets without storing the raw URL as the target value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("1", { status: 200 }));
    const upsertDeliveryTarget = vi.fn().mockImplementation(async (_env, target) => ({
      id: "teams-target-1",
      ...target,
      metadata: target.metadata,
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }));
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn(),
      upsertDeliveryTarget,
    }));

    const { saveTeamsWebhookTarget } = await import("~/lib/teams.server");
    const webhookUrl = fakeTeamsWebhookUrl();
    const target = await saveTeamsWebhookTarget(env as never, {
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
        channel: "teams",
        targetValue: expect.stringMatching(/^teams:/),
        validationStatus: "validated",
        isValidated: true,
        isOptedIn: true,
      }),
    );
    expect(target?.targetValue).not.toContain(webhookUrl);
    expect(String(target?.metadata.encryptedWebhookUrl)).not.toContain(webhookUrl);
    expect(target?.metadata.displayName).toBe("Growth alerts");
  });

  it("does not save Teams webhook targets when the setup test fails", async () => {
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById: vi.fn(),
      upsertDeliveryTarget,
    }));

    const { saveTeamsWebhookTarget } = await import("~/lib/teams.server");

    await expect(
      saveTeamsWebhookTarget(
        env as never,
        {
          userId: "user-1",
          webhookUrl: fakeTeamsWebhookUrl(),
          name: "Growth alerts",
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(new Response("Invalid webhook URL", { status: 404 })),
        },
      ),
    ).rejects.toThrow(Response);
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });

  it("pauses an owned Teams target by id", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue(teamsTarget());
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { pauseTeamsWebhookTarget } = await import("~/lib/teams.server");
    const paused = await pauseTeamsWebhookTarget(env as never, {
      userId: "user-1",
      targetId: "teams-target-1",
    });

    expect(paused).toBe(true);
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "teams",
        targetValue: "teams:abc",
        isPaused: true,
      }),
    );
  });

  it("resumes an owned paused Teams target by id", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue(teamsTarget({ isPaused: true }));
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { resumeTeamsWebhookTarget } = await import("~/lib/teams.server");
    const resumed = await resumeTeamsWebhookTarget(env as never, {
      userId: "user-1",
      targetId: "teams-target-1",
    });

    expect(resumed).toBe(true);
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "teams",
        targetValue: "teams:abc",
        isPaused: false,
        pausedAt: null,
      }),
    );
  });

  it("refuses to pause a target that is not a Teams target", async () => {
    const getDeliveryTargetById = vi.fn().mockResolvedValue(teamsTarget({ channel: "slack" }));
    const upsertDeliveryTarget = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      getDeliveryTargetById,
      upsertDeliveryTarget,
    }));

    const { pauseTeamsWebhookTarget } = await import("~/lib/teams.server");
    const paused = await pauseTeamsWebhookTarget(env as never, {
      userId: "user-1",
      targetId: "teams-target-1",
    });

    expect(paused).toBe(false);
    expect(upsertDeliveryTarget).not.toHaveBeenCalled();
  });
});

describe("sendTeamsWebhookUrl", () => {
  it("keeps transport-ambiguous Teams failures terminal instead of claiming delivery", async () => {
    const { sendTeamsWebhookUrl } = await import("~/lib/teams-webhook.server");
    const result = await sendTeamsWebhookUrl(
      fakeTeamsWebhookUrl(),
      { text: "Five to Nine alert" },
      { fetchImpl: vi.fn().mockRejectedValue(new Error("connection reset after write")) },
    );

    expect(result).toMatchObject({
      provider: "microsoft_teams_incoming_webhook",
      status: "failed",
      webhookStatus: "provider_unknown",
      providerMessageId: null,
      deliveredAt: null,
    });
  });

  it("marks a 2xx Teams response as delivered — the only accepted proof", async () => {
    const { sendTeamsWebhookUrl } = await import("~/lib/teams-webhook.server");
    const fetchMock = vi.fn().mockResolvedValue(new Response("1", { status: 200 }));
    const result = await sendTeamsWebhookUrl(
      fakeTeamsWebhookUrl(),
      { text: "Five to Nine alert", title: "Alert" },
      { fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      fakeTeamsWebhookUrl(),
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Five to Nine alert",
          title: "Alert",
        }),
      }),
    );
    expect(result).toMatchObject({
      status: "sent",
      webhookStatus: "delivered",
      errorMessage: null,
    });
    expect(result.deliveredAt).toBeTruthy();
  });

  it("fails closed on non-2xx Teams responses with the provider error text", async () => {
    const { sendTeamsWebhookUrl } = await import("~/lib/teams-webhook.server");
    const result = await sendTeamsWebhookUrl(
      fakeTeamsWebhookUrl(),
      { text: "Five to Nine alert" },
      { fetchImpl: vi.fn().mockResolvedValue(new Response("Invalid webhook URL", { status: 404 })) },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      providerMessageId: null,
      deliveredAt: null,
      errorMessage: "Teams send failed with HTTP 404: Invalid webhook URL",
    });
  });

  it("bounded oversized Teams webhook error bodies", async () => {
    const { sendTeamsWebhookUrl } = await import("~/lib/teams-webhook.server");
    const result = await sendTeamsWebhookUrl(
      fakeTeamsWebhookUrl(),
      { text: "Five to Nine alert" },
      { fetchImpl: vi.fn().mockResolvedValue(new Response("x".repeat(20_000), { status: 500 })) },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      deliveredAt: null,
    });
    expect(result.errorMessage?.length).toBeLessThan(500);
  });

  it("fails closed without an encrypted webhook instead of guessing a URL", async () => {
    const { sendTeamsWebhookMessage } = await import("~/lib/teams-webhook.server");
    const fetchMock = vi.fn().mockResolvedValue(new Response("1", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTeamsWebhookMessage(
      env as never,
      teamsTarget({ metadata: {} }),
      { text: "Five to Nine alert" },
    );

    expect(result).toMatchObject({
      status: "failed",
      webhookStatus: "failed",
      errorMessage: "Teams webhook is not connected for this destination.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
