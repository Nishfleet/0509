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

    expect(nudges.map((nudge) => nudge.id)).toEqual([
      "first_proof",
      "first_digest",
    ]);
  });

  it("prompts delivery proof without claiming readiness when delivery has no proof", () => {
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
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "delivery_proof",
        title: "Delivery proof is missing",
        href: "/app/sources",
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
    });

    expect(nudges).toEqual([
      expect.objectContaining({
        id: "agent_setup",
        title: "Agent setup is missing",
      }),
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
        detail: expect.stringContaining("support cases"),
      }),
    ]);
  });
});
