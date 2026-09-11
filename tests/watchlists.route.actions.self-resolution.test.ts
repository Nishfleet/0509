import { describe, expect, it, vi } from "vitest";

import {
  createContext,
  session,
  setupWatchlistsRouteTestIsolation,
  watchlist,
} from "./helpers/watchlists-route-fixtures";

setupWatchlistsRouteTestIsolation();

describe("watchlist setup self-resolution (#2418)", () => {
  it("resolves the advertiser and website from the single target field", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Nykaa launch watch",
      targetId: "https://nykaa.com",
      targetLabel: "Nykaa",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWorkspaceBranding: vi.fn().mockResolvedValue({ brandWebsite: null }),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Nykaa launch watch");
    // The merged field: no separate competitorWebsite, just the domain.
    formData.set("targetLabel", "https://www.nykaa.com/?utm_source=meta");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        name: "Nykaa launch watch",
        targetType: "advertiser",
        targetId: "https://nykaa.com",
        targetLabel: "Nykaa",
        targetCountry: null,
        trackingRole: "competitor",
      }),
    );
  });

  it("infers self tracking from a domain typed into the single target field", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Samplebrand watch",
      trackingRole: "self",
      targetId: "https://samplebrand.com",
      targetLabel: "Samplebrand",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWorkspaceBranding: vi
        .fn()
        .mockResolvedValue({ brandWebsite: "samplebrand.com" }),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Samplebrand watch");
    formData.set("targetLabel", "samplebrand.com");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        targetId: "https://samplebrand.com",
        targetLabel: "Samplebrand",
        trackingRole: "self",
      }),
    );
  });

  it("keeps a search term typed into the single target field a keyword target", async () => {
    const updateWatchlist = vi.fn().mockResolvedValue({
      ...watchlist,
      name: "Serum watch",
      targetId: "skincare serum",
      targetLabel: "skincare serum",
      targetCountry: null,
    });

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "update-watchlist");
    formData.set("watchlistId", "watch-1");
    formData.set("name", "Serum watch");
    formData.set("targetLabel", "skincare serum");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Watchlist updated.",
      ok: true,
    });
    expect(updateWatchlist).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "watch-1",
      expect.objectContaining({
        targetId: "skincare serum",
        targetLabel: "skincare serum",
        trackingRole: "competitor",
      }),
    );
  });

  it("logs a prefill_match line per save naming the edited fields", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const updateWatchlist = vi.fn().mockResolvedValue(watchlist);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
      requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
        session,
        workspaceUserId: session.user.id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWorkspaceBranding: vi.fn().mockResolvedValue({ brandWebsite: null }),
      updateWatchlist,
    }));

    const { action } = await import("~/routes/app.watchlists");

    // Untouched prefill: fixture name + label come back verbatim.
    const untouched = new FormData();
    untouched.set("intent", "update-watchlist");
    untouched.set("watchlistId", "watch-1");
    untouched.set("name", "Nykaa watch");
    untouched.set("targetLabel", "Nykaa");
    await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: untouched,
      }),
    } as never);

    // Edited name + retargeted field.
    const edited = new FormData();
    edited.set("intent", "update-watchlist");
    edited.set("watchlistId", "watch-1");
    edited.set("name", "Renamed watch");
    edited.set("targetLabel", "mamaearth.com");
    await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: edited,
      }),
    } as never);

    const lines = infoSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("watchlist_setup_save"))
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(
      expect.objectContaining({
        event: "watchlist_setup_save",
        watchlist_id: "watch-1",
        prefill_match: true,
        fields: [],
      }),
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({
        event: "watchlist_setup_save",
        prefill_match: false,
        fields: ["name", "target"],
      }),
    );
  });
});
