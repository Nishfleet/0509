import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundFeed } from "../../app/lib/feeds/sweep.server";
import { findFeed } from "../../app/lib/feeds/sweep.server";

const NONE: FoundFeed = { entityId: "e1", feedUrl: null, watched: false };

const { readThrough, readEnabledSourceId } = vi.hoisted(() => ({
  readThrough: vi.fn(),
  readEnabledSourceId: vi.fn(),
}));

vi.mock("../../app/lib/identity/probe-cache.server", () => ({
  readThrough,
}));

vi.mock("../../app/lib/data/source.server", () => ({
  readEnabledSourceId,
}));

vi.mock("../../app/lib/data/watch.server", () => ({
  insertWatches: vi.fn(),
  readEntitiesWithoutFeedWatch: vi.fn(),
  readFeedTargets: vi.fn(),
}));

beforeEach(() => {
  readThrough.mockReset();
  readEnabledSourceId.mockReset();
});

describe("findFeed", () => {
  it.each(["blog.rival.com", "localhost", "192.168.0.1"])(
    "returns no feed for %s without touching the cache",
    async (domain) => {
      await expect(findFeed({ id: "e1", domain })).resolves.toEqual(NONE);
      expect(readThrough).not.toHaveBeenCalled();
    },
  );

  it("calls readThrough for a registrable domain and returns none when the cache has no url", async () => {
    readThrough.mockResolvedValue({ feedUrl: null });
    await expect(findFeed({ id: "e1", domain: "rival.com" })).resolves.toEqual(NONE);
    expect(readThrough).toHaveBeenCalledTimes(1);
    expect(readThrough).toHaveBeenCalledWith(expect.objectContaining({ key: "feed:rival.com:url" }));
    expect(readEnabledSourceId).not.toHaveBeenCalled();
  });
});
