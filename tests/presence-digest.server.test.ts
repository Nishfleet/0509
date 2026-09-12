import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluatePresenceWorkspaceAccess: vi.fn(),
  getUserPlan: vi.fn(),
  listPresenceItems: vi.fn(),
  listTrackedEntities: vi.fn(),
  sendPresenceDigestEmail: vi.fn(),
  listResweepUsers: vi.fn(),
  resolveMonitoringFanoutMode: vi.fn(),
}));

vi.mock("~/lib/delivery.server", () => ({
  sendPresenceDigestEmail: mocks.sendPresenceDigestEmail,
}));
vi.mock("~/lib/mention-resweep.server", () => ({
  listResweepUsers: mocks.listResweepUsers,
}));
vi.mock("~/lib/monitoring-fanout.server", () => ({
  resolveMonitoringFanoutMode: mocks.resolveMonitoringFanoutMode,
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

describe("runPresenceDigestSweep", () => {
  /** D1-shaped double: prepare().bind(...).all() over the owner-address read. */
  function makeDb(results: Array<{ id: string; email: string }>) {
    return {
      prepare: () => ({
        bind: () => ({
          all: () => Promise.resolve({ results }),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluatePresenceWorkspaceAccess.mockResolvedValue({ allowed: true });
    mocks.getUserPlan.mockResolvedValue("agency");
    mocks.resolveMonitoringFanoutMode.mockReturnValue("fanout");
    mocks.listPresenceItems.mockResolvedValue([
      {
        trackedEntityId: "entity-1",
        title: "New pricing page",
        connectorId: "website",
      },
    ]);
    mocks.listTrackedEntities.mockResolvedValue([{ id: "entity-1", label: "Acme" }]);
    mocks.sendPresenceDigestEmail.mockResolvedValue({ accepted: true, delivered: true });
  });

  it("skips without a database", async () => {
    const { runPresenceDigestSweep } = await import("~/lib/presence-digest.server");
    const result = await runPresenceDigestSweep({} as never);
    expect(result).toEqual({
      swept: 0,
      delivered: 0,
      skipped: 0,
      errors: 0,
      skippedReason: "db_unavailable",
    });
  });

  it("skips inline fanout deployments, exactly like the mention re-sweep", async () => {
    mocks.resolveMonitoringFanoutMode.mockReturnValue("inline");
    const { runPresenceDigestSweep } = await import("~/lib/presence-digest.server");
    const result = await runPresenceDigestSweep({ DB: makeDb([]) } as never);
    expect(result).toEqual({
      swept: 0,
      delivered: 0,
      skipped: 0,
      errors: 0,
      skippedReason: "inline_mode",
    });
  });

  it("delivers to the resweep set with the owner's address; addressless and itemless workspaces are skipped", async () => {
    // This case is the regression proof for the owner-address read: the map
    // must resolve from the SAME rows the query returned, so every listed
    // workspace with an address is attempted exactly once.
    mocks.listResweepUsers.mockResolvedValue(["user-1", "user-2", "user-3"]);
    // Only user-1 resolves a website item; user-3 (addressed) lands in the
    // no_items skip, user-2 (addressless) in the no-address skip.
    mocks.listPresenceItems.mockImplementation(
      (_env: unknown, userId: string, options: { connectorId?: string }) =>
        userId === "user-1" && options?.connectorId === "website"
          ? Promise.resolve([
              { trackedEntityId: "entity-1", title: "Pricing page", connectorId: "website" },
            ])
          : Promise.resolve([]),
    );

    const { runPresenceDigestSweep } = await import("~/lib/presence-digest.server");
    const result = await runPresenceDigestSweep({ DB: makeDb([
      { id: "user-1", email: "one@example.com" },
      // user-2 deliberately missing from the owner read -> skipped.
      { id: "user-3", email: "three@example.com" },
    ]) } as never);

    expect(result).toEqual({ swept: 1, delivered: 1, skipped: 2, errors: 0 });
    expect(mocks.listResweepUsers).toHaveBeenCalledWith(expect.anything(), 100);
    expect(mocks.sendPresenceDigestEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendPresenceDigestEmail.mock.calls[0]![1]).toMatchObject({
      userId: "user-1",
      email: "one@example.com",
    });
  });

  it("counts a failed delivery as an error and keeps sweeping the next workspace", async () => {
    mocks.listResweepUsers.mockResolvedValue(["user-1", "user-2"]);
    const send = mocks.sendPresenceDigestEmail;
    send.mockRejectedValueOnce(new Error("rate limited"));

    const { runPresenceDigestSweep } = await import("~/lib/presence-digest.server");
    const result = await runPresenceDigestSweep({ DB: makeDb([
      { id: "user-1", email: "one@example.com" },
      { id: "user-2", email: "two@example.com" },
    ]) } as never);

    expect(result).toEqual({ swept: 2, delivered: 1, skipped: 0, errors: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
