import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDeliveryEntitlements,
  ROUTE_FEATURE_REQUIREMENTS,
} from "~/lib/plan-feature-gate.server";
import type {
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

const watchlist = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser" as const,
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-04-18T09:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T09:00:00.000Z",
};

const workspaceDeliveryConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-delivery-1",
  userId: "user-1",
  sensitivityMode: "balanced",
  instantEnabled: false,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: true,
  teamsEnabled: true,
  quietHours: null,
  timezone: "UTC",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

function createContext() {
  return { cloudflare: { env: { DB: {} } } };
}

describe("delivery entitlement helpers", () => {
  it("strips slack and instant flags for scout at execution time", () => {
    const config: WatchlistDeliveryConfigRecord = {
      id: "watch-delivery-1",
      watchlistId: "watch-1",
      userId: "user-1",
      sensitivityMode: "balanced",
      instantEnabled: true,
      digestEnabled: true,
      emailEnabled: true,
      whatsappEnabled: false,
      slackEnabled: true,
      teamsEnabled: true,
      quietHours: null,
      timezone: "UTC",
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:00.000Z",
    };

    expect(applyDeliveryEntitlements("scout", config)).toEqual({
      ...config,
      instantEnabled: false,
      slackEnabled: false,
      teamsEnabled: false,
      emailEnabled: true,
    });
  });

  it("restores starter slack and instant after downgrade reactivation", () => {
    const config = {
      instantEnabled: true,
      slackEnabled: true,
      teamsEnabled: true,
      emailEnabled: true,
    };

    expect(applyDeliveryEntitlements("starter", config)).toEqual(config);
  });
});

describe("watchlists save-delivery-config gates", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects scout slack delivery configuration", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("slackEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: "plan_gated",
      feature: "slack_delivery",
      message: "This capability is not included in your current plan.",
    });
  });

  it("rejects scout instant alerts configuration", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig: vi.fn(),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("instantEnabled", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      error: "plan_gated",
      feature: "high_priority_alerts",
      plan: "scout",
    });
  });
});

describe("shared report branding gates", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses stored branding on public shares after downgrade", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: () => ({ DB: {} }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getShareLink: vi.fn().mockResolvedValue({
        token: "share-token",
        userId: "user-1",
        resourceType: "collection",
        resourceId: "collection-1",
        isSnapshot: false,
      }),
      getCollection: vi.fn().mockResolvedValue({ id: "collection-1", name: "Board" }),
      listCollectionItems: vi.fn().mockResolvedValue([]),
      getDigest: vi.fn(),
      getWatchlist: vi.fn(),
      listWatchEvents: vi.fn().mockResolvedValue([]),
			getWorkspaceBranding: vi.fn().mockResolvedValue({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: "data:image/png;base64,iVBORw0KGgo=",
			}),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));

    const { loader } = await import("~/routes/share.$token");
    const data = await loader({
      context: createContext(),
      params: { token: "share-token" },
      request: new Request("http://localhost/share/share-token"),
    } as never);

    expect(data.preparedBy).toBeNull();
		expect(data.brandIdentity).toBeNull();
  });

  it("renders agency branding on public shares when entitled", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: () => ({ DB: {} }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getShareLink: vi.fn().mockResolvedValue({
        token: "share-token",
        userId: "user-1",
        resourceType: "collection",
        resourceId: "collection-1",
        isSnapshot: false,
      }),
      getCollection: vi.fn().mockResolvedValue({ id: "collection-1", name: "Board" }),
      listCollectionItems: vi.fn().mockResolvedValue([]),
      getDigest: vi.fn(),
      getWatchlist: vi.fn(),
      listWatchEvents: vi.fn().mockResolvedValue([]),
			getWorkspaceBranding: vi.fn().mockResolvedValue({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: "data:image/png;base64,iVBORw0KGgo=",
			}),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("agency"),
    }));

    const { loader } = await import("~/routes/share.$token");
    const data = await loader({
      context: createContext(),
      params: { token: "share-token" },
      request: new Request("http://localhost/share/share-token"),
    } as never);

    expect(data.preparedBy).toBe("Northwind Growth");
		expect(data.brandIdentity).toEqual({
			brandName: "Northwind Growth",
			brandWebsite: "https://northwind.example",
			brandLogo: "data:image/png;base64,iVBORw0KGgo=",
		});
	});
});

describe("workspace brand identity gate", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null for plans without agency branding", async () => {
		const getWorkspaceBranding = vi.fn();
		vi.doMock("~/lib/plan.server", () => ({
			getUserPlan: vi.fn().mockResolvedValue("starter"),
		}));
		vi.doMock("~/lib/data.server", () => ({
			getWorkspaceBranding,
		}));

		const { resolveWorkspaceBrandIdentity } = await import("~/lib/plan-feature-gate.server");
		const identity = await resolveWorkspaceBrandIdentity({ DB: {} } as never, "user-1");

		expect(identity).toBeNull();
		expect(getWorkspaceBranding).not.toHaveBeenCalled();
	});

	it("returns the full brand identity for agency plans", async () => {
		const logo = "data:image/png;base64,iVBORw0KGgo=";
		vi.doMock("~/lib/plan.server", () => ({
			getUserPlan: vi.fn().mockResolvedValue("agency"),
		}));
		vi.doMock("~/lib/data.server", () => ({
			getWorkspaceBranding: vi.fn().mockResolvedValue({
				brandName: "Northwind Growth",
				brandWebsite: "https://northwind.example",
				brandLogo: logo,
			}),
		}));

		const { resolveWorkspaceBrandIdentity } = await import("~/lib/plan-feature-gate.server");
		const identity = await resolveWorkspaceBrandIdentity({ DB: {} } as never, "user-1");

		expect(identity).toEqual({
			brandName: "Northwind Growth",
			brandWebsite: "https://northwind.example",
			brandLogo: logo,
		});
  });
});

describe("route feature requirement coverage", () => {
  it("lists delivery and branding entry points", () => {
    const serialized = JSON.stringify(ROUTE_FEATURE_REQUIREMENTS);
    expect(serialized).toContain("save-delivery-config");
    expect(serialized).toContain("save-report-branding");
    expect(serialized).toContain("share.$token");
    expect(serialized).toContain("deliverWatchlistAlerts");
  });

  it("wires authoritative delivery gates in server entry points", () => {
    // BL-007: the watchlists action moved out of the route into its own
    // server module; the gate is asserted where the code now lives.
    const watchlists = readFileSync(
      join(process.cwd(), "app/lib/watchlist-route-actions.server.ts"),
      "utf8",
    );
    const delivery = readFileSync(join(process.cwd(), "app/lib/delivery.server.ts"), "utf8");
    const share = readFileSync(join(process.cwd(), "app/routes/share.$token.tsx"), "utf8");
    const account = readFileSync(join(process.cwd(), "app/routes/app.account.tsx"), "utf8");

    expect(watchlists).toContain("requireDeliveryConfigSave");
    expect(delivery).toContain("resolveEntitledDeliveryConfigs");
		expect(share).toContain("resolveWorkspaceBrandIdentity");
    expect(account).toContain("agency_branding");
  });
});
