import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

function authModule() {
  return {
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: "user-1",
      isMember: false,
      ownerName: null,
    }),
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

async function postWatchlists(formData: FormData) {
  const { action } = await import("~/routes/app.watchlists");
  return action({
    context: createContext(),
    params: {},
    request: new Request("https://0509.io/app/watchlists", {
      method: "POST",
      body: formData,
    }),
  } as never);
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("watchlists bulk competitor import", () => {
  it("previews a pasted list without writing watchlists", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlistWithinLimit = vi.fn();
    const listWatchlists = vi.fn().mockResolvedValue([]);

    vi.doMock("~/lib/auth.server", () => authModule());
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit,
      listWatchlists,
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 1,
        limit: 10,
      }),
    }));

    const formData = new FormData();
    formData.set("intent", "preview-market-desk-import");
    formData.set("importSurface", "watchlists");
    formData.set("competitors", "boat-lifestyle.com\nnoise.com");

    const result = (await postWatchlists(formData)) as {
      ok: boolean;
      intent: string;
      preview: { selectedCount: number };
    };

    expect(result).toMatchObject({
      ok: true,
      intent: "preview-market-desk-import",
      preview: { selectedCount: 2 },
    });
    expect(createWatchlistWithinLimit).not.toHaveBeenCalled();
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("creates the selected rows and stays on watchlists", async () => {
    const completeUserOnboarding = vi.fn();
    const createWatchlistWithinLimit = vi
      .fn()
      .mockResolvedValueOnce({
        status: "created",
        watchlist: { id: "watch-1", targetLabel: "boAt Lifestyle" },
        current: 2,
        limit: 10,
      })
      .mockResolvedValueOnce({
        status: "created",
        watchlist: { id: "watch-2", targetLabel: "Noise" },
        current: 3,
        limit: 10,
      });
    const queueFirstWatchlistScan = vi.fn();

    vi.doMock("~/lib/auth.server", () => authModule());
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    vi.doMock("~/lib/data.server", () => ({
      completeUserOnboarding,
      createWatchlistWithinLimit,
      listWatchlists: vi.fn().mockResolvedValue([]),
      upsertAgentMemory: vi.fn(),
      upsertClientRoom: vi.fn(),
      upsertWorkspaceBranding: vi.fn(),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      queueFirstWatchlistScan,
      queueFirstWatchlistScanForSignupFirstBrief: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      checkPlanLimit: vi.fn().mockResolvedValue({
        allowed: true,
        current: 1,
        limit: 10,
      }),
      getUserPlan: vi.fn().mockResolvedValue("starter"),
    }));

    const formData = new FormData();
    formData.set("intent", "create-market-desk-import");
    formData.set("importSurface", "watchlists");
    formData.set("competitors", "boat-lifestyle.com\nnoise.com");
    formData.append("selectedRowIds", "row-1");
    formData.append("selectedRowIds", "row-2");

    await expectRedirect(
      () => postWatchlists(formData),
      "/app/watchlists?imported=2",
    );

    expect(createWatchlistWithinLimit).toHaveBeenCalledTimes(2);
    expect(queueFirstWatchlistScan).toHaveBeenCalledTimes(2);
    expect(completeUserOnboarding).not.toHaveBeenCalled();
  });
});
