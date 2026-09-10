import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Seam #2218 — generic competitor-source field action on
 * app.watchlists.$watchlistId.tsx (was render-only). The action writes the
 * seam's own competitor columns, allowlisted by (sourceId, field), scoped
 * to the signed-in owner. #2199's manual "Job board URL" field has no other
 * endpoint.
 */

const workspaceUserId = "user-1";
const watchlistId = "wl-1";

// Captured by the mocked ensureDb chain so the test can assert the SQL/binds.
let lastUpdate: { sql: string; binds: unknown[] } | null = null;

function makePrepared() {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        run: vi.fn(() => {
          lastUpdate = { sql, binds };
        }),
      })),
    })),
  };
}

vi.mock("~/lib/auth.server", () => ({
  requireWorkspaceSession: vi.fn().mockResolvedValue({ workspaceUserId }),
}));

vi.mock("~/lib/context.server", () => ({
  getEnv: vi.fn().mockReturnValue({}),
}));

vi.mock("~/lib/data.server", () => ({
  getWatchlist: vi.fn(),
}));

vi.mock("~/lib/data/d1.server", () => ({
  ensureDb: vi.fn().mockReturnValue(makePrepared()),
}));

const { getWatchlist } = await import("~/lib/data.server");

function makeRequest(formData: FormData) {
  return new Request("https://0509.io/app/watchlists/wl-1", {
    method: "POST",
    body: formData,
  });
}

function makeArgs(formData: FormData): ActionFunctionArgs {
  return {
    context: { cloudflare: { env: {} } },
    request: makeRequest(formData),
    params: { watchlistId },
  } as unknown as ActionFunctionArgs;
}

describe("update-source-field action (seam #2218)", () => {
  beforeEach(() => {
    vi.mocked(getWatchlist).mockReset();
    lastUpdate = null;
  });

  it("rejects an unknown intent", async () => {
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "something-else");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: false, error: "unknown_intent" });
  });

  it("rejects an invalid (sourceId, field) combination", async () => {
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "google");
    formData.set("field", "tiktok_advertiser");
    formData.set("value", "tt-1");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: false, error: "invalid_source_field" });
  });

  it("returns not_found when the watchlist does not exist", async () => {
    vi.mocked(getWatchlist).mockResolvedValueOnce(null as never);
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "tiktok");
    formData.set("field", "tiktok_advertiser");
    formData.set("value", "tt-1");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("writes tiktok_advertiser for the tiktok source", async () => {
    lastUpdate = null;
    vi.mocked(getWatchlist).mockResolvedValueOnce({ id: watchlistId, isActive: true } as never);
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "tiktok");
    formData.set("field", "tiktok_advertiser");
    formData.set("value", "tt-adv-1");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: true, sourceId: "tiktok", field: "tiktok_advertiser" });
    expect(lastUpdate).not.toBeNull();
    expect(lastUpdate!.sql).toContain("tiktok_advertiser");
    expect(lastUpdate!.binds[0]).toBe("tt-adv-1");
    expect(lastUpdate!.binds[1]).toBe(watchlistId);
  });

  it("writes job_board_verified coerced to 1 for a truthy value", async () => {
    lastUpdate = null;
    vi.mocked(getWatchlist).mockResolvedValueOnce({ id: watchlistId, isActive: true } as never);
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "hiring");
    formData.set("field", "job_board_verified");
    formData.set("value", "true");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: true, sourceId: "hiring", field: "job_board_verified" });
    expect(lastUpdate!.binds[0]).toBe(1);
  });

  it("writes job_board_verified coerced to 0 for a falsy value", async () => {
    lastUpdate = null;
    vi.mocked(getWatchlist).mockResolvedValueOnce({ id: watchlistId, isActive: true } as never);
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "hiring");
    formData.set("field", "job_board_verified");
    formData.set("value", "0");
    const result = await action(makeArgs(formData));
    expect(result.ok).toBe(true);
    expect(lastUpdate!.binds[0]).toBe(0);
  });

  it("writes job_board_provider for the hiring source", async () => {
    lastUpdate = null;
    vi.mocked(getWatchlist).mockResolvedValueOnce({ id: watchlistId, isActive: true } as never);
    const { action } = await import("~/routes/app.watchlists.$watchlistId");
    const formData = new FormData();
    formData.set("intent", "update-source-field");
    formData.set("sourceId", "hiring");
    formData.set("field", "job_board_provider");
    formData.set("value", "greenhouse");
    const result = await action(makeArgs(formData));
    expect(result).toEqual({ ok: true, sourceId: "hiring", field: "job_board_provider" });
    expect(lastUpdate!.sql).toContain("job_board_provider");
    expect(lastUpdate!.binds[0]).toBe("greenhouse");
  });
});
