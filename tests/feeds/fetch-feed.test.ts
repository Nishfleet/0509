import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as OutboundServer from "../../app/lib/fetch/outbound.server";
import type * as RobotsServer from "../../app/lib/fetch/robots.server";
import type { OutboundInit } from "../../app/lib/fetch/outbound.server";
import { fetchFeed, fetchHomepage } from "../../app/lib/feeds/fetch-feed.server";
import { CRAWLER_USER_AGENT } from "../../app/lib/fetch/robots.server";

// 0509#6476: fetch-feed.server.ts held about 12 untested branches with no test
// of its own. The only network edge is fetchOutbound and the only policy edge
// is robotsAllows, so mocking those two (cappedText stays real) makes every
// branch of requestHeaders, classify, fetchFeed and fetchHomepage reachable
// without a live network.

const FEED_URL = "https://rival.com/feed.xml";
const HOME_URL = "https://rival.com/";

const ETAG = '"etag-v1"';
const LAST_MODIFIED = "Wed, 21 Oct 2015 07:28:00 GMT";

// One declared byte over MAX_FEED_BYTES, so the real cappedText sees a
// content-length that declares over the cap and returns null.
const OVER_CAP_CONTENT_LENGTH = String(2 * 1024 * 1024 + 1);

const { fetchOutboundMock, robotsAllowsMock } = vi.hoisted(() => ({
  fetchOutboundMock: vi.fn<(url: string, init: OutboundInit) => Promise<Response>>(),
  robotsAllowsMock: vi.fn<(url: string) => Promise<boolean>>(),
}));

vi.mock("../../app/lib/fetch/outbound.server", async (importOriginal) => {
  const actual = await importOriginal<typeof OutboundServer>();
  return { ...actual, fetchOutbound: fetchOutboundMock };
});

vi.mock("../../app/lib/fetch/robots.server", async (importOriginal) => {
  const actual = await importOriginal<typeof RobotsServer>();
  return { ...actual, robotsAllows: robotsAllowsMock };
});

function feedResponse(status: number, headers: Record<string, string>, body = "<rss/>"): Response {
  return new Response(body, { status, headers });
}

function headersOfCall(index = 0): Headers {
  return new Headers(fetchOutboundMock.mock.calls[index]?.[1]?.headers);
}

function loggedJson(spy: ReturnType<typeof vi.spyOn>, call = 0): unknown {
  return JSON.parse(String(spy.mock.calls[call]?.[0]));
}

beforeEach(() => {
  fetchOutboundMock.mockReset();
  robotsAllowsMock.mockReset();
  robotsAllowsMock.mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestHeaders sends the stored validators to fetchOutbound", () => {
  it("sends if-none-match for an etag alone", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, {}));
    await fetchFeed(FEED_URL, { etag: ETAG, lastModified: null });

    const headers = headersOfCall();
    expect(headers.get("if-none-match")).toBe(ETAG);
    expect(headers.has("if-modified-since")).toBe(false);
    expect(headers.get("user-agent")).toBe(CRAWLER_USER_AGENT);
    expect(headers.get("accept")).toContain("application/rss+xml");
  });

  it("sends if-modified-since for a last-modified alone", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, {}));
    await fetchFeed(FEED_URL, { etag: null, lastModified: LAST_MODIFIED });

    const headers = headersOfCall();
    expect(headers.get("if-modified-since")).toBe(LAST_MODIFIED);
    expect(headers.has("if-none-match")).toBe(false);
    expect(headers.get("user-agent")).toBe(CRAWLER_USER_AGENT);
  });

  it("sends both validators when the feed has an etag and a last-modified", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, {}));
    await fetchFeed(FEED_URL, { etag: ETAG, lastModified: LAST_MODIFIED });

    const headers = headersOfCall();
    expect(headers.get("if-none-match")).toBe(ETAG);
    expect(headers.get("if-modified-since")).toBe(LAST_MODIFIED);
  });

  it("sends no validator header when the feed has none", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, {}));
    await fetchFeed(FEED_URL, null);

    const headers = headersOfCall();
    expect(headers.has("if-none-match")).toBe(false);
    expect(headers.has("if-modified-since")).toBe(false);
    expect(headers.get("user-agent")).toBe(CRAWLER_USER_AGENT);
  });
});

describe("classify maps the response to a FeedFetch outcome", () => {
  it("reads a 304 as not-modified", async () => {
    // A 304 carries no body, so this one cannot go through feedResponse.
    fetchOutboundMock.mockResolvedValue(new Response(null, { status: 304 }));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "not-modified" });
  });

  it("reads a 404 as gone", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(404, {}, "not found"));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "gone" });
  });

  it("reads a 410 as gone", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(410, {}, "gone for good"));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "gone" });
  });

  it("reads a 500 as unreadable", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(500, {}, "boom"));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "unreadable" });
  });

  it("reads a 200 that declares more than the 2 MiB cap as unreadable", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, { "content-length": OVER_CAP_CONTENT_LENGTH }));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "unreadable" });
  });

  it("reads a 200 as ok, copies the etag and last-modified headers as validators, and keeps the body", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, { etag: ETAG, "last-modified": LAST_MODIFIED }));
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({
      outcome: "ok",
      body: "<rss/>",
      validators: { etag: ETAG, lastModified: LAST_MODIFIED },
    });
  });
});

describe("fetchFeed guards the fetch and logs a failure", () => {
  it("returns unreadable without fetching when robots disallows the feed", async () => {
    robotsAllowsMock.mockResolvedValue(false);
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "unreadable" });
    expect(fetchOutboundMock).not.toHaveBeenCalled();
  });

  it("returns unreadable and logs one feed.fetch_failed line with no URL when fetchOutbound throws", async () => {
    fetchOutboundMock.mockRejectedValue(new TypeError("connect ETIMEDOUT"));
    const logSpy = vi.spyOn(console, "log");

    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "unreadable" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(loggedJson(logSpy)).toEqual({ event: "feed.fetch_failed", error: "TypeError" });
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain(FEED_URL);

    fetchOutboundMock.mockRejectedValue("connection reset, not an Error");
    await expect(fetchFeed(FEED_URL, null)).resolves.toEqual({ outcome: "unreadable" });
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(loggedJson(logSpy, 1)).toEqual({ event: "feed.fetch_failed", error: "unknown" });
    expect(String(logSpy.mock.calls[1]?.[0])).not.toContain(FEED_URL);
  });
});

describe("fetchHomepage reads the page under the same guards", () => {
  it("returns null without fetching when robots disallows the homepage", async () => {
    robotsAllowsMock.mockResolvedValue(false);
    await expect(fetchHomepage(HOME_URL)).resolves.toBeNull();
    expect(fetchOutboundMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-ok response", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(500, {}, "boom"));
    await expect(fetchHomepage(HOME_URL)).resolves.toBeNull();
  });

  it("returns null and logs one feed.homepage_failed line with no URL when fetchOutbound throws", async () => {
    fetchOutboundMock.mockRejectedValue(new TypeError("connect ETIMEDOUT"));
    const logSpy = vi.spyOn(console, "log");

    await expect(fetchHomepage(HOME_URL)).resolves.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(loggedJson(logSpy)).toEqual({ event: "feed.homepage_failed", error: "TypeError" });
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain(HOME_URL);

    fetchOutboundMock.mockRejectedValue("connection reset, not an Error");
    await expect(fetchHomepage(HOME_URL)).resolves.toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(loggedJson(logSpy, 1)).toEqual({ event: "feed.homepage_failed", error: "unknown" });
    expect(String(logSpy.mock.calls[1]?.[0])).not.toContain(HOME_URL);
  });

  it("returns the body on an ok response", async () => {
    fetchOutboundMock.mockResolvedValue(feedResponse(200, {}, "<html><title>Rival</title></html>"));
    await expect(fetchHomepage(HOME_URL)).resolves.toBe("<html><title>Rival</title></html>");
  });
});
