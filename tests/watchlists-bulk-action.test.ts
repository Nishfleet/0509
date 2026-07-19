import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-07-01T00:00:00.000Z",
  },
  session: { id: "session-1", userId: "user-1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function installMocks({
  setWatchlistActive = vi.fn().mockResolvedValue(true),
  requireWorkspacePlanLimit = vi.fn().mockResolvedValue({
    ok: true,
    plan: "starter",
    planLimit: { limit: 10, current: 1 },
  }),
}: {
  setWatchlistActive?: ReturnType<typeof vi.fn>;
  requireWorkspacePlanLimit?: ReturnType<typeof vi.fn>;
} = {}) {
  const env = { DB: {} };
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId: "user-1",
      isMember: false,
    }),
  }));
  vi.doMock("~/lib/data.server", () => ({ setWatchlistActive }));
  vi.doMock("~/lib/with-workspace.server", () => ({ requireWorkspacePlanLimit }));
  return { env, setWatchlistActive, requireWorkspacePlanLimit };
}

async function runBulkAction(fields: Record<string, string | string[]>) {
  const { action } = await import("~/routes/app.watchlists");
  const body = new FormData();
  body.set("intent", "bulk-watchlists");
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      body.append(key, entry);
    }
  }
  return (await action({
    context: {},
    params: {},
    request: new Request("https://0509.io/app/watchlists", { method: "POST", body }),
  } as never)) as { ok: boolean; message: string; error?: string };
}

describe("bulk-watchlists action", () => {
  it("pauses every selected watchlist through setWatchlistActive", async () => {
    const { setWatchlistActive } = installMocks();
    const result = await runBulkAction({
      bulkAction: "pause",
      watchlistIds: ["wl-1", "wl-2", "wl-3"],
    });

    expect(setWatchlistActive).toHaveBeenCalledTimes(3);
    expect(setWatchlistActive).toHaveBeenNthCalledWith(1, expect.anything(), "user-1", "wl-1", false);
    expect(setWatchlistActive).toHaveBeenNthCalledWith(3, expect.anything(), "user-1", "wl-3", false);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Paused 3 of 3 selected");
  });

  it("dedupes ids and rejects an empty or unknown bulk action", async () => {
    const { setWatchlistActive } = installMocks();
    const deduped = await runBulkAction({
      bulkAction: "pause",
      watchlistIds: ["wl-1", "wl-1"],
    });
    expect(setWatchlistActive).toHaveBeenCalledTimes(1);
    expect(deduped.message).toContain("Paused 1 of 1 selected");

    const empty = await runBulkAction({ bulkAction: "pause" });
    expect(empty.ok).toBe(false);
    expect(empty.message).toBe("Select at least one watchlist first.");

    const unknown = await runBulkAction({ bulkAction: "delete", watchlistIds: ["wl-1"] });
    expect(unknown.ok).toBe(false);
  });

  it("re-checks the plan limit before each resume and stops honestly at the cap", async () => {
    const requireWorkspacePlanLimit = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, plan: "free", planLimit: { limit: 1, current: 0 } })
      .mockResolvedValueOnce({
        ok: false,
        plan: "free",
        planLimit: { limit: 1, current: 1 },
        result: {
          ok: false,
          error: "plan_limit_exceeded",
          limit: 1,
          current: 1,
          message: "You have reached your competitor tracking limit — pause another watchlist first.",
        },
        response: new Response(null, { status: 402 }),
      });
    const { setWatchlistActive } = installMocks({ requireWorkspacePlanLimit });

    const result = await runBulkAction({
      bulkAction: "resume",
      watchlistIds: ["wl-1", "wl-2", "wl-3"],
    });

    // Only the first id resumed before the limit closed the door.
    expect(setWatchlistActive).toHaveBeenCalledTimes(1);
    expect(setWatchlistActive).toHaveBeenCalledWith(expect.anything(), "user-1", "wl-1", true);
    expect(requireWorkspacePlanLimit).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("plan_limit_exceeded");
    expect(result.message).toContain("Resumed 1 of 3 selected");
  });

  it("resumes all selected watchlists when the plan allows it", async () => {
    const { setWatchlistActive, requireWorkspacePlanLimit } = installMocks();
    const result = await runBulkAction({
      bulkAction: "resume",
      watchlistIds: ["wl-1", "wl-2"],
    });

    expect(requireWorkspacePlanLimit).toHaveBeenCalledTimes(2);
    expect(setWatchlistActive).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Resumed 2 of 2 selected");
  });
});
