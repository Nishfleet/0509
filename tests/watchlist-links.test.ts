import { describe, expect, it } from "vitest";

import {
  findWatchedCompetitor,
  matchesAdvertiserFilter,
  watchlistLiveSearchHref,
  watchlistSavedAdsHref,
} from "~/lib/watchlist-links";

const websiteWatchlist = {
  id: "wl-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "https://nykaa.com",
  targetLabel: "Nykaa",
  targetCountry: "India",
  trackingRole: "competitor",
};

const labelWatchlist = {
  id: "wl-2",
  name: "Serum watch",
  targetType: "saved_query",
  targetId: "sq-1",
  targetLabel: "skincare serum",
  targetCountry: null,
  trackingRole: "competitor",
};

describe("watchlistLiveSearchHref", () => {
  it("prefills the website field for website-backed watchlists", () => {
    const href = watchlistLiveSearchHref(websiteWatchlist);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/search?")).toBe(true);
    expect(params.get("website")).toBe("https://nykaa.com");
    expect(params.get("country")).toBe("India");
    expect(params.get("query")).toBeNull();
  });

  it("falls back to an advertiser query for label-only watchlists", () => {
    const href = watchlistLiveSearchHref(labelWatchlist);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("mode")).toBe("advertiser");
    expect(params.get("query")).toBe("skincare serum");
    expect(params.get("website")).toBeNull();
    expect(params.get("country")).toBeNull();
  });
});

describe("watchlistSavedAdsHref", () => {
  it("links the boards route filtered by the tracked advertiser", () => {
    expect(watchlistSavedAdsHref({ targetLabel: "Nykaa & co" })).toBe(
      "/app/collections?advertiser=Nykaa%20%26%20co",
    );
  });
});

describe("matchesAdvertiserFilter", () => {
  it("matches case-insensitively and treats an empty filter as match-all", () => {
    expect(matchesAdvertiserFilter("Nykaa Fashion", "nykaa")).toBe(true);
    expect(matchesAdvertiserFilter("Mamaearth", "nykaa")).toBe(false);
    expect(matchesAdvertiserFilter(null, "nykaa")).toBe(false);
    expect(matchesAdvertiserFilter("Anything", "")).toBe(true);
    expect(matchesAdvertiserFilter("Anything", null)).toBe(true);
  });
});

describe("findWatchedCompetitor", () => {
  const watchlists = [websiteWatchlist, labelWatchlist];

  it("matches a searched host against website-backed watchlists", () => {
    expect(
      findWatchedCompetitor(watchlists, { host: "nykaa.com", query: "something else" }),
    ).toEqual({ id: "wl-1", name: "Nykaa watch" });
    expect(
      findWatchedCompetitor(watchlists, { host: "www.Nykaa.com", query: null }),
    ).toEqual({ id: "wl-1", name: "Nykaa watch" });
  });

  it("matches the query against the tracked label when no host matches", () => {
    expect(
      findWatchedCompetitor(watchlists, { host: null, query: "Skincare Serum" }),
    ).toEqual({ id: "wl-2", name: "Serum watch" });
  });

  it("returns null when nothing matches and skips self-brand watchlists", () => {
    expect(findWatchedCompetitor(watchlists, { host: "mamaearth.in", query: "mamaearth" })).toBeNull();
    expect(
      findWatchedCompetitor(
        [{ ...websiteWatchlist, trackingRole: "self" }],
        { host: "nykaa.com", query: "nykaa" },
      ),
    ).toBeNull();
    expect(findWatchedCompetitor([], { host: "nykaa.com", query: "nykaa" })).toBeNull();
  });

  it("ignores malformed stored URLs instead of throwing", () => {
    expect(
      findWatchedCompetitor(
        [{ ...websiteWatchlist, targetId: "https://" }],
        { host: "nykaa.com", query: "nykaa" },
      ),
    ).toEqual({ id: "wl-1", name: "Nykaa watch" });
  });
});
