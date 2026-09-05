import { describe, expect, it } from "vitest";

import {
  DEFAULT_WATCHLIST_DETAIL_TAB,
  WATCHLIST_DETAIL_TABS,
  resolveWatchlistDetailTab,
  watchlistDetailTabCount,
  watchlistDetailTabHref,
} from "~/lib/watchlist-detail-tabs";

describe("competitor detail tabs (brief §6.4)", () => {
  it("keeps the fixed brief order", () => {
    expect(WATCHLIST_DETAIL_TABS.map((tab) => tab.id)).toEqual([
      "changed",
      "evidence",
      "creative",
      "delivery",
      "library",
      "setup",
    ]);
    expect(WATCHLIST_DETAIL_TABS.map((tab) => tab.label)).toEqual([
      "What changed",
      "Evidence",
      "Creative",
      "Delivery",
      "Library",
      "Setup",
    ]);
  });

  it("resolves a missing, blank or unknown tab to the change feed instead of erroring", () => {
    expect(resolveWatchlistDetailTab(null)).toBe(DEFAULT_WATCHLIST_DETAIL_TAB);
    expect(resolveWatchlistDetailTab(undefined)).toBe("changed");
    expect(resolveWatchlistDetailTab("  ")).toBe("changed");
    expect(resolveWatchlistDetailTab("nonsense")).toBe("changed");
    expect(resolveWatchlistDetailTab("../setup")).toBe("changed");
  });

  it("accepts every real tab, case-insensitively", () => {
    for (const tab of WATCHLIST_DETAIL_TABS) {
      expect(resolveWatchlistDetailTab(tab.id)).toBe(tab.id);
      expect(resolveWatchlistDetailTab(tab.id.toUpperCase())).toBe(tab.id);
    }
  });

  it("drops the tab param on the default tab so a band click and an email link are one URL", () => {
    expect(watchlistDetailTabHref("watch-1")).toBe("/app/watchlists?watchlist=watch-1");
    expect(watchlistDetailTabHref("watch-1", "changed")).toBe(
      "/app/watchlists?watchlist=watch-1",
    );
  });

  it("builds an addressable href for every other tab, and keeps event deep links", () => {
    expect(watchlistDetailTabHref("watch-1", "delivery")).toBe(
      "/app/watchlists?watchlist=watch-1&tab=delivery",
    );
    expect(watchlistDetailTabHref("watch-1", "changed", { eventId: "event-9" })).toBe(
      "/app/watchlists?watchlist=watch-1&event=event-9",
    );
    expect(watchlistDetailTabHref("watch 1", "setup")).toBe(
      "/app/watchlists?watchlist=watch+1&tab=setup",
    );
  });

  it("badges only the change feed, and only with a real captured count", () => {
    expect(watchlistDetailTabCount("changed", 3)).toBe(3);
    expect(watchlistDetailTabCount("changed", 0)).toBeNull();
    expect(watchlistDetailTabCount("evidence", 3)).toBeNull();
    expect(watchlistDetailTabCount("delivery", 12)).toBeNull();
  });
});
