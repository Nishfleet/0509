import { describe, expect, it } from "vitest";

import { toPublicDeliveryTarget } from "~/lib/delivery-target-public";
import type { DeliveryTargetRecord } from "~/lib/types";

describe("toPublicDeliveryTarget", () => {
  it("strips encrypted Slack webhook metadata from client-facing delivery targets", () => {
    const target: DeliveryTargetRecord = {
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
        webhookHost: "hooks.slack.com",
      },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    };

    expect(toPublicDeliveryTarget(target)).toMatchObject({
      channel: "slack",
      targetValue: "Connected Slack workspace",
      providerIdentifier: null,
      metadata: {
        displayName: "Growth alerts",
      },
    });
    expect(JSON.stringify(toPublicDeliveryTarget(target))).not.toContain("encryptedWebhookUrl");
    expect(JSON.stringify(toPublicDeliveryTarget(target))).not.toContain("ciphertext");
  });

  it("uses only the currently verified account email for email targets", () => {
    const target = {
      id: "email-target-1",
      userId: "user-1",
      watchlistId: "watchlist-1",
      channel: "email" as const,
      targetValue: "owner@example.com",
      validationStatus: "validated" as const,
      isValidated: true,
      isOptedIn: true,
      optInSource: "watchlist_settings",
      optedInAt: null,
      isPaused: false,
      pausedAt: null,
      optedOutAt: null,
      templateEligible: true,
      lastSuccessfulDeliveryAt: null,
      lastSuccessfulAttemptId: null,
      providerIdentifier: "provider-secret",
      metadata: {},
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    } satisfies DeliveryTargetRecord;

    expect(toPublicDeliveryTarget(target, { verifiedAccountEmail: "member@example.com" })).toMatchObject({
      targetValue: "member@example.com",
      providerIdentifier: null,
    });
    expect(JSON.stringify(toPublicDeliveryTarget(target))).not.toContain("owner@example.com");
  });
});
