import { describe, expect, it } from "vitest";

import {
  buildDeliveryBatchKey,
  evaluateDeliveryPolicy,
  normalizeSensitivityMode,
  resolveDeliveryConfig,
} from "~/lib/delivery-policy.server";
import type {
  WatchEventRecord,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

const workspaceConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: true,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: {
    startHour: 22,
    endHour: 8,
  },
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

function watchEvent(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 82,
    adId: "meta-boat-1",
    baselineFromRunId: "run-0",
    candidateId: "candidate-1",
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "boAt",
    },
    confirmedAt: "2026-04-18T10:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("delivery policy", () => {
  it("treats auto as balanced in v1", () => {
    expect(normalizeSensitivityMode("auto")).toBe("balanced");
    expect(normalizeSensitivityMode("aggressive")).toBe("aggressive");
  });

  it("inherits workspace defaults when there is no watchlist override", () => {
    const resolved = resolveDeliveryConfig({
      workspaceConfig,
      watchlistConfig: null,
    });

    expect(resolved).toMatchObject({
      sensitivityMode: "balanced",
      instantEnabled: true,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: false,
      timezone: "Asia/Kolkata",
    });
  });

  it("lets the watchlist override workspace defaults", () => {
    const watchlistConfig: WatchlistDeliveryConfigRecord = {
      id: "watch-delivery-1",
      watchlistId: "watch-1",
      userId: "user-1",
      sensitivityMode: "quiet",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: true,
      slackEnabled: false,
      teamsEnabled: false,
      quietHours: null,
      timezone: "UTC",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    };

    const resolved = resolveDeliveryConfig({
      workspaceConfig,
      watchlistConfig,
    });

    expect(resolved).toMatchObject({
      sensitivityMode: "quiet",
      instantEnabled: false,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: true,
      slackEnabled: false,
      teamsEnabled: false,
      quietHours: null,
      timezone: "UTC",
    });
  });

  it("allows confirmed customer events to interrupt in balanced mode when they clear the threshold", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent(),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-04-18T12:00:00.000Z",
    });

    expect(decision.instantEligible).toBe(true);
    expect(decision.digestEligible).toBe(true);
    expect(decision.allowedChannels).toEqual(["email"]);
    expect(decision.provisional).toBe(false);
  });

  it("includes Slack when the effective delivery config enables it", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent(),
      workspaceConfig: {
        ...workspaceConfig,
        whatsappEnabled: true,
        slackEnabled: true,
      },
      watchlistConfig: null,
      now: "2026-04-18T12:00:00.000Z",
    });

    expect(decision.allowedChannels).toEqual(["email", "whatsapp", "slack"]);
  });

  it("keeps customer proof_failed out of the interrupt path", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent({
        status: "proof_failed",
        eventType: "landing_page_cta_changed",
        importanceScore: 99,
      }),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-04-18T12:00:00.000Z",
    });

    expect(decision.instantEligible).toBe(false);
    expect(decision.digestEligible).toBe(false);
    expect(decision.skipReason).toBe("customer_requires_trusted_status");
  });

  it("allows internal proof_failed events when they clear the threshold", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "internal",
      event: watchEvent({
        status: "proof_failed",
        eventType: "landing_page_cta_changed",
        importanceScore: 88,
      }),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-04-18T12:00:00.000Z",
    });

    expect(decision.instantEligible).toBe(true);
    expect(decision.allowedChannels).toEqual(["email"]);
  });

  it("marks rare customer proof_pending sends as provisional", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent({
        status: "proof_pending",
        importanceScore: 97,
      }),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-04-18T12:00:00.000Z",
    });

    expect(decision.instantEligible).toBe(true);
    expect(decision.provisional).toBe(true);
  });

  it("defers instant sends during quiet hours while keeping digest eligibility", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent(),
      workspaceConfig,
      watchlistConfig: null,
      now: "2026-04-18T18:30:00.000Z",
    });

    expect(decision.instantEligible).toBe(false);
    expect(decision.digestEligible).toBe(true);
    expect(decision.deferredByQuietHours).toBe(true);
  });

  it("fails safe to UTC instead of throwing for a legacy invalid timezone", () => {
    const decision = evaluateDeliveryPolicy({
      lane: "customer",
      event: watchEvent(),
      workspaceConfig: {
        ...workspaceConfig,
        timezone: "Not/AZone",
      },
      watchlistConfig: null,
      now: "2026-04-18T23:30:00.000Z",
    });

    expect(decision.deferredByQuietHours).toBe(true);
    expect(decision.instantEligible).toBe(false);
  });

  it("builds stable batch keys from competitor, watchlist, and short time window", () => {
    const first = buildDeliveryBatchKey({
      watchlistId: "watch-1",
      competitorLabel: "boAt",
      eventCreatedAt: "2026-04-18T10:04:00.000Z",
    });
    const second = buildDeliveryBatchKey({
      watchlistId: "watch-1",
      competitorLabel: "boAt",
      eventCreatedAt: "2026-04-18T10:12:00.000Z",
    });
    const third = buildDeliveryBatchKey({
      watchlistId: "watch-1",
      competitorLabel: "Nykaa",
      eventCreatedAt: "2026-04-18T10:12:00.000Z",
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("never fires an instant alert for bare ad_new/ad_inactive creative churn (BET 1)", () => {
    // ad_new carries a base importance of 76 — above the balanced instant
    // threshold (75) — yet creative churn must never interrupt the customer on
    // its own. It only ever appears as a counted line in the digest brief.
    for (const eventType of ["ad_new", "ad_inactive"] as const) {
      const decision = evaluateDeliveryPolicy({
        lane: "customer",
        event: watchEvent({
          eventType,
          status: "confirmed",
          importanceScore: 100,
        }),
        workspaceConfig: {
          ...workspaceConfig,
          sensitivityMode: "aggressive",
        },
        watchlistConfig: null,
        now: "2026-04-18T12:00:00.000Z",
      });

      expect(decision.instantEligible).toBe(false);
      // Churn stays digest-eligible so it still reaches the counted footnote.
      expect(decision.digestEligible).toBe(true);
    }
  });
});
