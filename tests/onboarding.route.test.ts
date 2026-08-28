import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

async function expectRedirect(
  callback: () => Promise<unknown>,
  location: string,
  status = 302,
) {
  try {
    await callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(status);
    expect((error as Response).headers.get("Location")).toBe(location);
    return;
  }

  throw new Error(`Expected redirect to ${location}`);
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/env.server");
  vi.doUnmock("~/lib/presence-internal-access.server");
  vi.doUnmock("~/lib/setup-checklist-action.server");
  vi.doUnmock("~/lib/workspace.server");
  vi.resetModules();
});

function authModuleFromSession(session: unknown) {
  return {
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn(async () => ({
      session,
      workspaceUserId: (session as { user: { id: string } }).user.id,
      isMember: false,
      ownerName: null,
    })),
    getCachedWorkspaceForRequest: vi.fn(
      async (_env: unknown, _request: unknown, userId: string) => ({
        workspaceUserId: userId,
        isMember: false,
        ownerName: null,
      }),
    ),
  };
}

describe("auth signup loader", () => {
  it("defaults new signups to the setup card in Overview", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/auth.signup");

    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/auth/signup"),
    } as never);

    expect(result).toEqual({
      redirectTo: "/app#setup-checklist",
      prefillEmail: "",
      linkSent: false,
    });
  });
});

describe("retired onboarding compatibility route", () => {
  it("permanently redirects setup context to the anchored Overview card", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    const { loader } = await import("~/routes/app.onboard");

    await expectRedirect(
      () => loader({
        context: createContext(),
        request: new Request("http://localhost/app/onboard?website=nykaa.com&country=IN"),
      } as never),
      "/app?website=nykaa.com&country=IN#setup-checklist",
      301,
    );
  });

  it("keeps direct watchlist handoffs working", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    const { loader } = await import("~/routes/app.onboard");

    await expectRedirect(
      () => loader({
        context: createContext(),
        request: new Request("http://localhost/app/onboard?watchlist=watch-1"),
      } as never),
      "/app/watchlists?watchlist=watch-1",
      301,
    );
  });

  it("forwards a legacy POST to the setup action handler", async () => {
    const handleSetupChecklistAction = vi.fn().mockResolvedValue({
      ok: false,
      intent: "create-watchlist",
      message: "Keep the entered website visible.",
    });
    vi.doMock("~/lib/setup-checklist-action.server", () => ({
      handleSetupChecklistAction,
    }));
    const { action } = await import("~/routes/app.onboard");
    const args = {
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: new URLSearchParams({
          intent: "create-watchlist",
          website: "competitor.example",
        }),
      }),
    } as never;

    const response = await action(args);
    const result = await (response as Response).json();

    expect(result).toMatchObject({ intent: "create-watchlist" });
    expect((response as Response).headers.get("Set-Cookie")).toContain(
      "f9_onboard_compat=1",
    );
    expect(handleSetupChecklistAction).toHaveBeenCalledWith(args);
  });

  it("serves one compatibility loader pass after a legacy validation result", async () => {
    const session = {
      user: { id: "user-1", onboardedAt: "2026-07-01T00:00:00.000Z" },
      session: { id: "session-1", userId: "user-1" },
    };
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session,
        workspaceUserId: "user-1",
        isMember: false,
        ownerName: null,
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/data.server", () => ({
      getWorkspaceBranding: vi.fn().mockResolvedValue({
        brandWebsite: "https://brand.example",
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 0,
        limit: 1,
      }),
    }));
    const { loader } = await import("~/routes/app.onboard");

    const response = await loader({
      context: createContext(),
      request: new Request(
        "http://localhost/app/onboard?website=competitor.example&country=IN",
        {
          headers: { cookie: "f9_onboard_compat=1" },
        },
      ),
    } as never);
    const data = await (response as Response).json();

    expect(data).toMatchObject({
      plan: "free",
      prefillWebsite: "competitor.example",
      prefillCountry: "IN",
      resumeSetup: true,
      watchlistLimit: { allowed: true, current: 0, limit: 1 },
    });
    expect((response as Response).headers.get("Set-Cookie")).toContain(
      "Max-Age=0",
    );
  });
});

describe("setup checklist actions", () => {
  it("processes a member's shared-workspace setup action instead of redirecting it away", async () => {
    const completeUserOnboarding = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: {
          user: {
            id: "member-1",
            email: "member@example.com",
            name: "Member",
            onboardedAt: null,
          },
          session: {
            id: "session-member-1",
            userId: "member-1",
            expiresAt: "2026-04-03T00:00:00.000Z",
          },
        },
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn(),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("website", "incomplete");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "create-watchlist",
      message: "That website looks incomplete. Add the full domain, like brand.com.",
    });
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("never lets a member overwrite the workspace owner's brand website", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const upsertWorkspaceBranding = vi.fn();
    vi.doMock("~/lib/auth.server", () => ({
      requireWorkspaceSession: vi.fn().mockResolvedValue({
        session: {
          user: {
            id: "member-1",
            email: "member@example.com",
            name: "Member",
            onboardedAt: null,
          },
          session: {
            id: "session-member-1",
            userId: "member-1",
            expiresAt: "2026-04-03T00:00:00.000Z",
          },
        },
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      upsertWorkspaceBranding,
    }));
    vi.doMock("~/lib/plan.server", () => ({ checkPlanLimit: vi.fn() }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "finish");
    formData.set("brandWebsite", "https://attacker.example");

    await expectRedirect(
      () => action({
        context: createContext(),
        request: new Request("http://localhost/app", {
          method: "POST",
          body: formData,
        }),
      } as never),
      "/app",
    );

    expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "member-1");
  });

  it("creates a first watchlist and marks the user onboarded", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: {
        id: "watch-1",
        targetLabel: "Boat Lifestyle",
      },
      current: 1,
      limit: 3,
    });
    const upsertWorkspaceBranding = vi.fn().mockResolvedValue({
      brandName: null,
      brandWebsite: "https://mybrand.example",
    });

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlistWithinLimit,
      upsertWorkspaceBranding,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 0,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("website", "https://boat-lifestyle.com");
    formData.set("brandWebsite", "mybrand.example");

    await expectRedirect(
      () =>
        action({
          context: createContext(),
          request: new Request("http://localhost/app/onboard", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "/app/watchlists?watchlist=watch-1",
    );

    expect(createWatchlistWithinLimit).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({
        name: "Boat Lifestyle watch",
        targetType: "advertiser",
        targetId: "https://boat-lifestyle.com",
        targetLabel: "Boat Lifestyle",
      }),
      3,
    );
    expect(upsertWorkspaceBranding).toHaveBeenCalledWith({}, "user-1", {
      brandWebsite: "https://mybrand.example",
    });
    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
  });

  it("previews a bulk competitor import without writing watchlists", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();
    const listWatchlists = vi.fn().mockResolvedValue([]);

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlist,
      listWatchlists,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 1,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "preview-market-desk-import");
    formData.set("competitors", "boat-lifestyle.com\nnoise.com\nwakefit.co");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      intent: "preview-market-desk-import",
      message: "Ready to create 2 competitor watchlists.",
      preview: {
        availableSlots: 2,
        selectedCount: 2,
        summary: {
          duplicate: 0,
          existing: 0,
          invalid: 0,
          over_cap: 1,
          valid: 2,
        },
      },
    });
    expect(listWatchlists).toHaveBeenCalledWith({}, "user-1", { includeInactive: true });
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("previews competitor rows from an uploaded CSV file", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();
    const listWatchlists = vi.fn().mockResolvedValue([]);

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlist,
      listWatchlists,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 0,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "preview-market-desk-import");
    formData.set("competitors", "");
    formData.set(
      "competitorFile",
      new File(["name,domain\nBoat,boat-lifestyle.com\nNoise,noise.com\n"], "competitors.csv", {
        type: "text/csv",
      }),
    );

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: true,
      intent: "preview-market-desk-import",
      message: "Ready to create 2 competitor watchlists.",
      rawText: "name,domain\nBoat,boat-lifestyle.com\nNoise,noise.com",
      preview: {
        selectedCount: 2,
        summary: {
          valid: 2,
        },
      },
    });
    expect(listWatchlists).toHaveBeenCalledWith({}, "user-1", { includeInactive: true });
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("rejects oversized competitor import files before reading plan state", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();
    const listWatchlists = vi.fn();
    const checkPlanLimit = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlist,
      listWatchlists,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit,
    }));

    const { COMPETITOR_IMPORT_MAX_BYTES } = await import("~/lib/competitor-import");
    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "preview-market-desk-import");
    formData.set("competitors", "boat-lifestyle.com");
    formData.set(
      "competitorFile",
      new File(["x".repeat(COMPETITOR_IMPORT_MAX_BYTES + 1)], "competitors.csv", {
        type: "text/csv",
      }),
    );

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "preview-market-desk-import",
      message: "Import is too large. Paste or upload 195 KB or less.",
      rawText: "boat-lifestyle.com",
      brandWebsiteInput: "",
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(listWatchlists).not.toHaveBeenCalled();
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("rejects oversized multipart import requests before parsing the body", async () => {
    const completeUserOnboarding = vi.fn();
    const checkPlanLimit = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit,
    }));

    const { COMPETITOR_IMPORT_MAX_BYTES } = await import("~/lib/competitor-import");
    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: new Blob(["x"]),
        headers: {
          "content-type": "multipart/form-data; boundary=too-large",
          "content-length": String(COMPETITOR_IMPORT_MAX_BYTES + 40_000),
        },
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "preview-market-desk-import",
      message: "Import is too large. Paste or upload 195 KB or less.",
      rawText: "",
      brandWebsiteInput: "",
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("creates selected bulk competitors, saves branding, queues first scans, and finishes onboarding", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const createWatchlistWithinLimit = vi
      .fn()
      .mockResolvedValueOnce({
        status: "created",
        watchlist: { id: "watch-1", targetLabel: "Boat Lifestyle" },
        current: 1,
        limit: 3,
      })
      .mockResolvedValueOnce({
        status: "created",
        watchlist: { id: "watch-2", targetLabel: "Noise" },
        current: 2,
        limit: 3,
      });
    const listWatchlists = vi.fn().mockResolvedValue([]);
    const queueFirstWatchlistScan = vi.fn();
    const upsertAgentMemory = vi.fn().mockResolvedValue({
      id: "memory-1",
    });
    const upsertClientRoom = vi
      .fn()
      .mockResolvedValueOnce({
        id: "room-1",
        name: "Client A watch",
        clientLabel: "Client A",
        status: "active",
        resourceRefs: [],
        notes: {},
      })
      .mockResolvedValueOnce({
        id: "room-1",
        name: "Client A watch",
        clientLabel: "Client A",
        status: "active",
        resourceRefs: [
          {
            resourceType: "watchlist",
            resourceId: "watch-1",
            label: "Boat Lifestyle",
          },
        ],
        notes: {
          marketDeskImport: {
            source: "onboarding",
            importedGrouping: true,
          },
        },
      });
    const upsertWorkspaceBranding = vi.fn().mockResolvedValue({
      brandName: null,
      brandWebsite: "https://mybrand.example",
    });

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit,
      listWatchlists,
      upsertAgentMemory,
      upsertClientRoom,
      upsertWorkspaceBranding,
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      queueFirstWatchlistScan,
      queueFirstWatchlistScanForSignupFirstBrief: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 0,
        limit: 3,
      }),
      getUserPlan: vi.fn().mockResolvedValue("agency"),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-market-desk-import");
    formData.set(
      "competitors",
      [
        "name,website,notes,tags,client",
        "Boat Lifestyle,boat-lifestyle.com,Watch offers,audio; sale,Client A",
        "Noise,noise.com,,,",
      ].join("\n"),
    );
    formData.append("selectedRowIds", "row-2");
    formData.append("selectedRowIds", "row-3");
    formData.set("brandWebsite", "mybrand.example");

    await expectRedirect(
      () =>
        action({
          context: createContext(),
          request: new Request("http://localhost/app/onboard", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "/app?setup=market-desk&created=2",
    );

    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(2);
    expect(createWatchlistWithinLimit).toHaveBeenNthCalledWith(
      1,
      {},
      "user-1",
      expect.objectContaining({
        targetId: "https://boat-lifestyle.com",
        targetLabel: "Boat Lifestyle",
        trackingRole: "competitor",
      }),
      3,
    );
    expect(createWatchlistWithinLimit).toHaveBeenNthCalledWith(
      2,
      {},
      "user-1",
      expect.objectContaining({
        targetId: "https://noise.com",
        targetLabel: "Noise",
        trackingRole: "competitor",
      }),
      3,
    );
    expect(upsertAgentMemory).toHaveBeenCalledWith({}, "user-1", {
      scope: "competitor",
      key: "import_context",
      watchlistId: "watch-1",
      value: {
        competitor: "Boat Lifestyle",
        importedFrom: "market_desk_onboarding",
        notes: "Watch offers",
        tags: ["audio", "sale"],
        client: "Client A",
      },
      source: "market_desk_import",
    });
    expect(upsertClientRoom).toHaveBeenNthCalledWith(1, {}, "user-1", {
      name: "Client A watch",
      clientLabel: "Client A",
    });
    expect(upsertClientRoom).toHaveBeenNthCalledWith(2, {}, "user-1", {
      roomId: "room-1",
      name: "Client A watch",
      clientLabel: "Client A",
      status: "active",
      resourceRefs: [
        {
          resourceType: "watchlist",
          resourceId: "watch-1",
          label: "Boat Lifestyle",
        },
      ],
      notes: {
        marketDeskImport: {
          source: "onboarding",
          importedGrouping: true,
        },
      },
    });
    expect(queueFirstWatchlistScan).toHaveBeenCalledTimes(2);
    expect(upsertWorkspaceBranding).toHaveBeenCalledWith({}, "user-1", {
      brandWebsite: "https://mybrand.example",
    });
    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
  });

  it.each(["free", "scout", "starter"] as const)(
    "keeps %s CSV activation but does not create an Agency-only client room",
    async (plan) => {
      const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
      const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
        status: "created",
        watchlist: { id: "watch-1", targetLabel: "Boat Lifestyle" },
        current: 1,
        limit: plan === "free" ? 1 : 3,
      });
      const queueFirstWatchlistScan = vi.fn();
      const upsertClientRoom = vi.fn();

      vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
      vi.doMock("~/lib/data.server", () => ({
        completeUserOnboarding,
        createWatchlistWithinLimit,
        listWatchlists: vi.fn().mockResolvedValue([]),
        upsertAgentMemory: vi.fn(),
        upsertClientRoom,
        upsertWorkspaceBranding: vi.fn(),
      }));
      vi.doMock("~/lib/monitoring.server", () => ({
        queueFirstWatchlistScan,
        queueFirstWatchlistScanForSignupFirstBrief: vi.fn(),
      }));
      vi.doMock("~/lib/plan.server", () => ({
        checkPlanLimit: vi.fn().mockResolvedValue({
          allowed: true,
          current: 0,
          limit: plan === "free" ? 1 : 3,
        }),
        getUserPlan: vi.fn().mockResolvedValue(plan),
      }));

      const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
      const formData = new FormData();
      formData.set("intent", "create-market-desk-import");
      formData.set("competitors", "name,website,client\nBoat Lifestyle,boat-lifestyle.com,Client A");
      formData.append("selectedRowIds", "row-2");

      await expectRedirect(
        () =>
          action({
            context: createContext(),
            request: new Request("http://localhost/app/onboard", {
              method: "POST",
              body: formData,
            }),
          } as never),
        "/app?setup=market-desk&created=1",
      );

      expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(1);
      expect(queueFirstWatchlistScan).toHaveBeenCalledTimes(1);
      expect(upsertClientRoom).not.toHaveBeenCalled();
      expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
    },
  );

  it("does not silently create selected bulk rows beyond the current plan cap", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const createWatchlistWithinLimit = vi.fn();
    const queueFirstWatchlistScan = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit,
      listWatchlists: vi.fn().mockResolvedValue([]),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      queueFirstWatchlistScan,
      queueFirstWatchlistScanForSignupFirstBrief: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 2,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-market-desk-import");
    formData.set("competitors", "boat-lifestyle.com\nnoise.com");
    formData.append("selectedRowIds", "row-1");
    formData.append("selectedRowIds", "row-2");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      intent: "create-market-desk-import",
      error: "import_selection_rejected",
      message: "Row 2 cannot be created: Over the current plan limit. Select fewer competitors or upgrade.",
      rejectedRows: [
        {
          id: "row-2",
          rowNumber: 2,
          status: "over_cap",
        },
      ],
      preview: {
        selectedCount: 1,
        summary: {
          over_cap: 1,
          valid: 1,
        },
      },
    });
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
    expect(queueFirstWatchlistScan).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("rejects an existing bulk competitor instead of creating a duplicate", async () => {
    const { normalizeCompetitorWebsiteInput, watchlistFingerprint } = await import("~/lib/competitor-website");
    const { normalizeSavedQuery } = await import("~/lib/normalize");
    const existingWebsite = normalizeCompetitorWebsiteInput("https://boat-lifestyle.com");
    const existingFingerprint = watchlistFingerprint(
      normalizeSavedQuery("advertiser", {
        query: existingWebsite.searchTerm ?? "boat-lifestyle.com",
        country: "all",
      }),
      existingWebsite,
    );
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlist,
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watch-existing",
          isActive: true,
          targetFingerprint: existingFingerprint,
        },
      ]),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 1,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-market-desk-import");
    formData.set("competitors", "boat-lifestyle.com");
    formData.append("selectedRowIds", "row-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toMatchObject({
      ok: false,
      intent: "create-market-desk-import",
      error: "import_selection_rejected",
      message: "Row 1 cannot be created: Already tracked in this workspace.",
      rejectedRows: [
        {
          id: "row-1",
          rowNumber: 1,
          status: "existing",
        },
      ],
      preview: {
        selectedCount: 0,
        summary: {
          existing: 1,
        },
      },
    });
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("rejects an incomplete website instead of creating a broken first watchlist", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();
    const checkPlanLimit = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlist,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit,
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("website", "samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "create-watchlist",
      message: "That website looks incomplete. Add the full domain, like brand.com.",
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("rejects an invalid brand website before creating the first watchlist", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlist = vi.fn();
    const upsertWorkspaceBranding = vi.fn();
    const checkPlanLimit = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlist,
      upsertWorkspaceBranding,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit,
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("website", "https://boat-lifestyle.com");
    formData.set("brandWebsite", "samplebrand");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      intent: "create-watchlist",
      message: "That website looks incomplete. Add the full domain, like brand.com.",
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(createWatchlist).not.toHaveBeenCalled();
    expect(upsertWorkspaceBranding).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("returns a structured upgrade prompt when onboarding watchlists are capped", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "over_cap",
      watchlist: null,
      current: 3,
      limit: 3,
    });

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: false,
        current: 3,
        limit: 3,
      }),
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("query", "boAt");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/onboard", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      current: 3,
      error: "plan_limit_exceeded",
      intent: "create-watchlist",
      limit: 3,
      message: "You've reached your competitor monitoring limit.",
      ok: false,
      upgradePath: "/app/billing?source=onboarding#plans",
    });
    expect(createWatchlistWithinLimit).toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("marks the user onboarded when they skip setup", async () => {
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);
    const upsertWorkspaceBranding = vi.fn().mockResolvedValue({
      brandName: null,
      brandWebsite: "https://mybrand.example",
    });

    vi.doMock("~/lib/auth.server", () => authModuleFromSession({
        user: {
          id: "user-1",
          email: "owner@example.com",
          name: "Owner",
          onboardedAt: null,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-04-03T00:00:00.000Z",
        },
      }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlist: vi.fn(),
      upsertWorkspaceBranding,
    }));

    const { handleSetupChecklistAction: action } = await import("~/lib/setup-checklist-action.server");
    const formData = new FormData();
    formData.set("intent", "finish");
    formData.set("brandWebsite", "mybrand.example");

    await expectRedirect(
      () =>
        action({
          context: createContext(),
          request: new Request("http://localhost/app/onboard", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "/app",
    );

    expect(upsertWorkspaceBranding).toHaveBeenCalledWith({}, "user-1", {
      brandWebsite: "https://mybrand.example",
    });
    expect(completeUserOnboarding).toHaveBeenCalledWith({}, "user-1");
  });

});
