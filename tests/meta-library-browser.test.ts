import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function buildQuery() {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nykaa",
      country: "India",
      platform: "all" as const,
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
  };
}

function createBrowserHarness() {
  const evaluate = vi.fn().mockResolvedValue([
    {
      libraryId: "1234567890",
      advertiser: "Nykaa",
      body: "Flat 30% off on serums",
      previewHeadline: "Glow sale",
      previewSubhead: "Weekend only",
      cta: "Shop now",
      adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
      landingPageUrl: "https://www.nykaa.com/glow-sale",
      platforms: ["Instagram", "Facebook"],
      active: true,
    },
  ]);
  const page = {
    close: vi.fn().mockResolvedValue(undefined),
    evaluate,
    goto: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
  };
  const browserContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    createBrowserContext: vi.fn().mockResolvedValue(browserContext),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    browser,
    browserContext,
    page,
  };
}

function buildQuickActionContent(
  input: {
    cards?: Array<Record<string, unknown>>;
    loginWall?: boolean;
    rateLimited?: boolean;
  } = {},
) {
  const payload = {
    cards:
      input.cards ??
      [
        {
          libraryId: "1234567890",
          advertiser: "Nykaa",
          body: "Flat 30% off on serums",
          previewHeadline: "Glow sale",
          previewSubhead: null,
          cta: "Shop now",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          platforms: ["Instagram", "Facebook"],
          active: true,
        },
      ],
    loginWall: input.loginWall ?? false,
    rateLimited: input.rateLimited ?? false,
  };

  return `<html><body><script id="__0509_ad_library_payload" type="application/json">${JSON.stringify(payload).replace(/<\//g, "<\\/")}</script></body></html>`;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("searchMetaLibraryByBrowser", () => {
  it("launches Browser Run with keep-alive and normalizes Ad Library results", async () => {
    const { browser, browserContext, page } = createBrowserHarness();
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    expect(sessions).toHaveBeenCalledWith({} as Fetcher);
    expect(limits).toHaveBeenCalledWith({} as Fetcher);
    expect(launch).toHaveBeenCalledWith(
      {} as Fetcher,
      expect.objectContaining({
        keep_alive: 180000,
      }),
    );
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("country=IN"),
      expect.objectContaining({
        waitUntil: "domcontentloaded",
        timeout: 20000,
      }),
    );
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("q=nykaa"),
      expect.any(Object),
    );
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      nextCursor: null,
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          previewHeadline: "Glow sale",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
          active: true,
          source: "meta",
        }),
      ],
    });
    expect(browser.createBrowserContext).toHaveBeenCalled();
    expect(browserContext.close).toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
    expect(browser.disconnect).toHaveBeenCalled();
  });

  it("reuses an idle Browser Run session before launching a new browser", async () => {
    const { browser, page } = createBrowserHarness();
    const launch = vi.fn();
    const sessions = vi.fn().mockResolvedValue([
      {
        sessionId: "session-1",
        startTime: 1000,
      },
    ]);
    const limits = vi.fn();
    const connect = vi.fn().mockResolvedValue(browser);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    expect(connect).toHaveBeenCalledWith({} as Fetcher, "session-1");
    expect(launch).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
  });

  it("fails honestly when Browser Run is unavailable", async () => {
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(searchMetaLibraryByBrowser({}, buildQuery())).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "browser_unavailable",
    });
  });

  it("fails fast when Browser Run reports no new browser acquisitions are allowed", async () => {
    const launch = vi.fn();
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 0,
      timeUntilNextAllowedBrowserAcquisition: 15000,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
      message: "Browser Run rate limited this request. Retry after about 15s.",
      retryAfterSeconds: 15,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("classifies Browser Run 429 launch failures as rate limited", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
    });
  });

  it("falls back to Quick Actions when Browser Run session launch is rate limited", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: buildQuickActionContent(),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1234",
          },
        },
      ),
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(launch).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          source: "meta",
        }),
      ],
    });
  });

  it("uses Quick Actions directly when the browser binding is unavailable", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: buildQuickActionContent(),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1234",
          },
        },
      ),
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
  });

  it("classifies Quick Actions 429 errors as rate limited", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "Too many requests" }],
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "10",
          },
        },
      ),
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER_RUN_ACCOUNT_ID: "acct-123",
          BROWSER_RUN_API_TOKEN: "token-123",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
      retryAfterSeconds: 10,
    });
  });
});
