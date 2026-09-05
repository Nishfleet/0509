import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluatePresenceWorkspaceAccess: vi.fn(),
  getUserPlan: vi.fn(),
  listPresenceItems: vi.fn(),
  listTrackedEntities: vi.fn(),
  sendPresenceDigestEmail: vi.fn(),
}));

vi.mock("~/lib/delivery.server", () => ({
  sendPresenceDigestEmail: mocks.sendPresenceDigestEmail,
}));
vi.mock("~/lib/presence-data.server", () => ({
  listPresenceItems: mocks.listPresenceItems,
  listTrackedEntities: mocks.listTrackedEntities,
}));
vi.mock("~/lib/presence-display", () => ({
  formatCoverageLabel: () => "Website",
}));
vi.mock("~/lib/plan.server", () => ({
  getUserPlan: mocks.getUserPlan,
}));
vi.mock("~/lib/presence-entitlements", () => ({
  canUsePresenceFeature: () => true,
}));
vi.mock("~/lib/presence-internal-access.server", () => ({
  evaluatePresenceWorkspaceAccess: mocks.evaluatePresenceWorkspaceAccess,
}));

describe("deliverPresenceDigestForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluatePresenceWorkspaceAccess.mockResolvedValue({ allowed: true });
    mocks.getUserPlan.mockResolvedValue("agency");
    mocks.listPresenceItems.mockResolvedValue([
      {
        trackedEntityId: "entity-1",
        title: "New pricing page",
        connectorId: "website",
      },
    ]);
    mocks.listTrackedEntities.mockResolvedValue([{ id: "entity-1", label: "Acme" }]);
  });

  it("keeps provider-accepted email explicitly unconfirmed", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: false });

    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const result = await deliverPresenceDigestForUser(
      { PRESENCE_DIGEST_ROLLOUT: "enabled" } as never,
      "user-1",
      "owner@example.com",
    );

    expect(result).toEqual({ delivered: false, reason: "delivery_unconfirmed" });
  });

  it("reports delivery only with genuine receipt evidence", async () => {
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });

    const { deliverPresenceDigestForUser } = await import("~/lib/presence-digest.server");
    const result = await deliverPresenceDigestForUser(
      { PRESENCE_DIGEST_ROLLOUT: "enabled" } as never,
      "user-1",
      "owner@example.com",
    );

    expect(result).toEqual({ delivered: true, itemCount: 1 });
  });
});
