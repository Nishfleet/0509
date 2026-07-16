import { describe, expect, it } from "vitest";

import { buildLifecycleNudges } from "~/lib/lifecycle-nudges.server";

const readyItems = [
  { id: "delivery", status: "ready" },
];

describe("buildLifecycleNudges", () => {
  it("prompts the first competitor for an empty workspace", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 0,
        activeWatchlists: 0,
        successfulProofs: 0,
        sentDigests: 0,
        deliveryTargets: 0,
        activeApiKeys: 0,
        agentMemoryEntries: 0,
        clientRooms: 0,
      },
      proofUsage: { warningLevel: "ok", used: 0, limit: 0 },
      includeBillingSupport: false,
    });

    expect(nudges.map((nudge) => nudge.id)).toContain("first_competitor");
    expect(nudges[0]).toMatchObject({
      id: "first_competitor",
      href: "/search",
      priority: "high",
    });
  });

  it("prompts proof capture when an active watchlist has no successful proof", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 0,
        sentDigests: 0,
        deliveryTargets: 0,
        activeApiKeys: 1,
        agentMemoryEntries: 1,
        clientRooms: 1,
      },
      proofUsage: { warningLevel: "ok", used: 1, limit: 100 },
      includeBillingSupport: false,
    });

    expect(nudges.map((nudge) => nudge.id)).toEqual(["first_proof"]);
  });

  it("prompts delivery check without claiming readiness when delivery has no successful send", () => {
    const nudges = buildLifecycleNudges({
      items: [{ id: "delivery", status: "needs_proof" }],
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 1,
        sentDigests: 1,
        deliveryTargets: 1,
        activeApiKeys: 1,
        agentMemoryEntries: 1,
        clientRooms: 1,
      },
      proofUsage: { warningLevel: "ok", used: 3, limit: 100 },
      includeBillingSupport: false,
      canUseDeveloperAccess: true,
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "delivery_proof",
        title: "Delivery check is missing",
        href: "/app/notifications",
        priority: "high",
      }),
    ]);
  });

  it("prompts agent setup when API and MCP access are missing", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 1,
        sentDigests: 1,
        deliveryTargets: 1,
        activeApiKeys: 0,
        agentMemoryEntries: 1,
        clientRooms: 1,
      },
      proofUsage: { warningLevel: "ok", used: 3, limit: 100 },
      includeBillingSupport: false,
      canUseDeveloperAccess: true,
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "agent_setup",
        title: "Developer access is missing",
        href: "/app/developer-access",
        priority: "low",
      }),
    ]);
  });

  it("keeps setup and digest upsells out of the activation lane until first value exists", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 0,
        sentDigests: 0,
        deliveryTargets: 0,
        activeApiKeys: 0,
        agentMemoryEntries: 0,
        clientRooms: 0,
      },
      proofUsage: { warningLevel: "ok", used: 0, limit: 100 },
      includeBillingSupport: false,
      canUseClientRooms: true,
      canUseDeveloperAccess: true,
    });

    expect(nudges).toEqual([
      expect.objectContaining({ id: "first_proof", priority: "high" }),
    ]);
  });

  it("prompts context capture when a client room has no memory", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 1,
        sentDigests: 1,
        deliveryTargets: 1,
        activeApiKeys: 1,
        agentMemoryEntries: 0,
        clientRooms: 1,
      },
      proofUsage: { warningLevel: "ok", used: 3, limit: 100 },
      includeBillingSupport: false,
      canUseClientRooms: true,
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "client_context",
        title: "Client context is missing",
        href: "/app/clients",
      }),
    ]);
  });

  it("points billing support nudges to signed-in support cases", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 1,
        sentDigests: 1,
        deliveryTargets: 1,
        activeApiKeys: 1,
        agentMemoryEntries: 1,
        clientRooms: 1,
      },
      proofUsage: { warningLevel: "ok", used: 3, limit: 100 },
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "billing_support",
        href: "/app/support?category=billing",
        detail: expect.stringContaining("support path"),
      }),
    ]);
  });

  it("treats an honest completed baseline as first value without requiring a sent digest", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        completedScans: 1,
        noChangeBaselines: 1,
        successfulProofs: 0,
        sentDigests: 0,
        deliveryTargets: 0,
        activeApiKeys: 0,
        agentMemoryEntries: 0,
        clientRooms: 0,
      },
      proofUsage: { warningLevel: "ok", used: 1, limit: 100 },
      includeBillingSupport: false,
    });

    expect(nudges.map((nudge) => nudge.id)).toEqual(["first_digest"]);
    expect(nudges.map((nudge) => nudge.id)).not.toContain("first_proof");
  });

  it("shows one urgent billing action and one activation action before first value without claiming a retry", () => {
    const nudges = buildLifecycleNudges({
      items: readyItems,
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        completedScans: 0,
        successfulProofs: 0,
        sentDigests: 0,
        deliveryTargets: 0,
        activeApiKeys: 0,
      },
      hasPaymentIssue: true,
      includeBillingSupport: true,
    });

    expect(nudges).toEqual([
      expect.objectContaining({ id: "payment_issue", priority: "high" }),
      expect.objectContaining({ id: "first_proof", priority: "medium" }),
    ]);
    expect(JSON.stringify(nudges)).not.toContain("retry");
    expect(JSON.stringify(nudges)).not.toContain("Dodo");
  });

  it("keeps a post-value payment interruption ahead of routine retained-work nudges", () => {
    const nudges = buildLifecycleNudges({
      items: [{ id: "delivery", status: "needs_proof" }],
      counts: {
        competitors: 1,
        activeWatchlists: 1,
        successfulProofs: 1,
        sentDigests: 0,
        deliveryTargets: 1,
        activeApiKeys: 0,
        agentMemoryEntries: 0,
        clientRooms: 0,
      },
      proofUsage: { warningLevel: "warning", used: 90, limit: 100 },
      hasPaymentIssue: true,
      canUseClientRooms: true,
      canUseDeveloperAccess: true,
    });

    expect(nudges.map((nudge) => nudge.id)).toEqual([
      "payment_issue",
      "proof_usage",
      "delivery_proof",
      "first_digest",
      "client_room_setup",
      "agent_setup",
      "billing_support",
    ]);
    expect(nudges.slice(0, 4).map((nudge) => nudge.id)).toContain("payment_issue");
  });
});
