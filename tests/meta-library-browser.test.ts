import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

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
    close: vi.fn().mockResolvedValue(undefined),
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
    noResults?: boolean;
    rateLimited?: boolean;
    withRunnerScript?: boolean;
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
    noResults: input.noResults ?? false,
    rateLimited: input.rateLimited ?? false,
  };

  const runnerScript = input.withRunnerScript
    ? `<script id="__0509_ad_library_extractor" type="application/javascript">(() => { throw new Error("not payload"); })();</script>`
    : "";
  return `<html><body>${runnerScript}<script id="__0509_ad_library_payload" type="application/json">${JSON.stringify(payload).replace(/<\//g, "<\\/")}</script></body></html>`;
}

function mockFetchWithDns(handler: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["31.13.70.36"] : [];
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({
            data: address,
            type: type === "A" ? 1 : 28,
          })),
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/dns-json",
          },
        },
      );
    }

    return handler(input, init);
  });
}

function nonDnsFetchCalls(fetch: ReturnType<typeof mockFetchWithDns>) {
  return fetch.mock.calls.filter(([input]) => !String(input).startsWith(DNS_JSON_ENDPOINT));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("searchMetaLibraryByBrowser", () => {
  it("launches Browser Run without session reuse and normalizes Ad Library results", async () => {
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

    expect(sessions).not.toHaveBeenCalled();
    expect(limits).toHaveBeenCalledWith({} as Fetcher);
    expect(launch).toHaveBeenCalledWith({} as Fetcher);
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
    const waitPredicate = page.waitForFunction.mock.calls[0][0] as (selector: string) => boolean;
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      body: {
        innerText: "Ad Library finished loading shell content",
      },
    });
    expect(waitPredicate("a[href]")).toBe(false);
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      body: {
        innerText: "No ads found for this query",
      },
    });
    expect(waitPredicate("a[href]")).toBe(true);
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
          source: "meta_library_browser",
        }),
      ],
    });
    expect(browser.createBrowserContext).toHaveBeenCalled();
    expect(browserContext.close).toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it("does not reuse idle Browser Run sessions unless explicitly enabled", async () => {
    const { browser, page } = createBrowserHarness();
    const launch = vi.fn().mockResolvedValue(browser);
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

    expect(sessions).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(limits).toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
    expect(browser.close).toHaveBeenCalled();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it("can reuse an idle Browser Run session behind the explicit reuse flag", async () => {
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
        BROWSER_RUN_SESSION_REUSE: "1",
      },
      buildQuery(),
    );

    expect(connect).toHaveBeenCalledWith({} as Fetcher, "session-1");
    expect(launch).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
    expect(browser.disconnect).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
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

  it("classifies Browser Run launch timeouts instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const launch = vi.fn(() => new Promise(() => undefined));
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

    const result = expect(
      searchMetaLibraryByBrowser({ BROWSER: {} as Fetcher }, buildQuery()),
    ).rejects.toMatchObject({
      failureClass: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    vi.useRealTimers();
  });

  it("uses Browserless BQL as a live commercial fallback when Browser Run is unavailable", async () => {
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <article>
                        <strong>Nykaa</strong>
                        <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                        <a href="/ads/library/?id=1234567890">View ad details</a>
                        <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                      </article>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );
    const bqlFetch = nonDnsFetchCalls(fetchSpy)[0];
    const requestBody = JSON.parse(String(bqlFetch?.[1]?.body ?? "{}"));

    expect(String(bqlFetch?.[0])).toContain("/stealth/bql?token=browserless-token");
    expect(requestBody.variables).toMatchObject({
      userAgent: expect.stringContaining("iPhone"),
    });
    expect(requestBody.variables.selector).toBeUndefined();
    expect(requestBody.query).toContain("waitForTimeout");
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          source: "meta_library_browser",
        }),
      ],
    });
    expect(result.discoveryEmptyReason).toBeUndefined();
  });

  it("classifies Browserless fetch aborts as timeouts", async () => {
    mockFetchWithDns(
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }) as never,
    );
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSERLESS_TOKEN: "browserless-token",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "timeout",
    });
  });

  it("classifies unreadable Browserless response bodies as timeouts", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("deadline", "AbortError"));
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSERLESS_TOKEN: "browserless-token",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "timeout",
    });
  });

  it("treats an explicit Browserless no-results page as a healthy empty Meta result", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <main>
                        <h1>No results</h1>
                        <p>We couldn't find any ads.</p>
                      </main>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
      ads: [],
    });
  });

  it("treats a Quick Actions no-results payload as healthy instead of scraping fallback", async () => {
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent({ cards: [], noResults: true }),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1000",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(1);
    expect(result.ads).toEqual([]);
    expect(result.discoveryEmptyReason).toBe("no_results");
  });

  it("retries a transient empty Browserless render before failing the Meta capture", async () => {
    const browserlessResponses = [
      new Response(
        JSON.stringify({
          data: {
            html: {
              html: "<html><body>No ad cards rendered yet</body></html>",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
      new Response(
        JSON.stringify({
          data: {
            html: {
              html: `
                <html>
                  <body>
                    <article>
                      <strong>Nykaa</strong>
                      <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                      <a href="/ads/library/?id=1234567890">View ad details</a>
                      <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                    </article>
                  </body>
                </html>
              `,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    ];
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () => browserlessResponses.shift() ?? new Response(null, { status: 500 })) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(2);
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "",
      }),
    ]);
  });

  it("extracts rendered Meta Ad Library text cards when ad-detail links are absent", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <main>
                        ~6,200 results
                        Active
                        Library ID: 1280520150312258
                        Started running on 14 Jul 2025
                        Platforms
                        This ad has multiple versions
                        Menu
                        See ad details
                        Nykaa Man
                        Sponsored
                        For the Man Who Never Settles For Less
                        Flat ₹400 Off on Your First Order
                        For the Man Who Never Settles For Less
                        Flat ₹400 Off on Your First Order
                        NYKAAMAN.COM
                        Shop Now
                      </main>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      ads: [
        expect.objectContaining({
          metaAdId: "1280520150312258",
          advertiser: "Nykaa Man",
          body:
            "For the Man Who Never Settles For Less\nFlat ₹400 Off on Your First Order\nNYKAAMAN.COM\nShop Now",
          previewHeadline: "For the Man Who Never Settles For Less",
          cta: "Shop Now",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1280520150312258",
          landingPageUrl: "https://nykaaman.com/",
          active: true,
          // Meta's published "Started running on" line becomes firstSeenAt…
          firstSeenAt: "2025-07-14",
          source: "meta_library_browser",
        }),
      ],
    });
    // …while staying excluded from the ad body as UI noise.
    expect(result.ads[0].body).not.toMatch(/started running/i);
  });

  it("keeps firstSeenAt null when the started-running line is unparseable", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <main>
                        Active
                        Library ID: 1280520150312259
                        Started running on soon
                        See ad details
                        Nykaa Man
                        Sponsored
                        For the Man Who Never Settles For Less
                        NYKAAMAN.COM
                        Shop Now
                      </main>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1280520150312259",
        // honest null: an unreadable date is never guessed
        firstSeenAt: null,
      }),
    ]);
    expect(result.ads[0].body).not.toMatch(/started running/i);
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

  it("fails honestly when a Browser Run session returns no extractable cards", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: false,
        rateLimited: false,
      });
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
      failureClass: "empty_result",
    });
  });

  it("treats Browser Run no-results page text as a healthy empty Meta result", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi.fn(async (callback: () => unknown) => {
      vi.stubGlobal("document", {
        querySelectorAll: vi.fn().mockReturnValue([]),
        body: {
          innerText: "No results We couldn't find any ads.",
        },
      });

      return callback();
    });
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

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
      ads: [],
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
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
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
      ) as never,
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
    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          source: "meta_library_browser",
        }),
      ],
    });
  });

  it("uses Browserless when Quick Actions time out after Browser Run session fallback", async () => {
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
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("/browser-rendering/content")) {
          throw new DOMException("aborted", "AbortError");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <article>
                        <strong>Nykaa</strong>
                        <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                        <a href="/ads/library/?id=1234567890">View ad details</a>
                        <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                      </article>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }) as never,
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
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );
    const liveFetches = nonDnsFetchCalls(fetch);

    expect(String(liveFetches[0]?.[0])).toContain("/browser-rendering/content");
    expect(String(liveFetches[1]?.[0])).toContain("/stealth/bql?token=browserless-token");
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        source: "meta_library_browser",
      }),
    ]);
  });

  it("falls back to Quick Actions when Browser Run session extraction is empty", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: false,
        rateLimited: false,
      });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
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
      ) as never,
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

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result.ads).toHaveLength(1);
  });

  it("falls back to Quick Actions when Browser Run session hits a login wall", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: true,
        rateLimited: false,
      });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
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
      ) as never,
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

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result.ads).toHaveLength(1);
  });

  it("uses Quick Actions directly when the browser binding is unavailable", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
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
      ) as never,
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

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(launch).not.toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
  });

  it("keeps the Quick Actions runner separate from the extraction payload", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent({
              withRunnerScript: true,
            }),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
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
    const requestBody = JSON.parse(String(nonDnsFetchCalls(fetchSpy)[0]?.[1]?.body ?? "{}"));

    expect(requestBody.addScriptTag[0]).toMatchObject({
      id: "__0509_ad_library_extractor",
      type: "application/javascript",
    });
    expect(requestBody.addScriptTag[0].id).not.toBe("__0509_ad_library_payload");
    expect(result.ads).toHaveLength(1);
  });

  it("falls back to rendered HTML links when Quick Actions payload script is missing", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: `
              <html>
                <body>
                  <article>
                    <strong>Nykaa</strong>
                    <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                    <a href="/ads/library/?id=1234567890">View ad details</a>
                    <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                  </article>
                </body>
              </html>
            `,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
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

    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        landingPageUrl: "https://www.nykaa.com/glow-sale",
        platforms: expect.arrayContaining(["Instagram", "Facebook"]),
      }),
    ]);
  });

  it("falls back to native Quick Actions scrape when content script injection is blocked", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const quickActionResponses = [
      new Response(
        JSON.stringify({
          success: true,
          result: "<html><body><main>No injected payload yet</main></body></html>",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1000",
          },
        },
      ),
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              selector: 'a[href*="/ads/library/?id="]',
              results: [
                {
                  attributes: [
                    {
                      name: "href",
                      value: "/ads/library/?id=1234567890",
                    },
                  ],
                  html: '<a href="/ads/library/?id=1234567890">Nykaa serum sale Shop now Instagram Facebook</a>',
                  text: "Nykaa serum sale Shop now Instagram Facebook",
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1000",
          },
        },
      ),
    ];
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () => quickActionResponses.shift() ?? new Response(null, { status: 500 })) as never,
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
    const pageFetches = nonDnsFetchCalls(fetchSpy);
    const scrapeRequest = JSON.parse(String(pageFetches[1]?.[1]?.body ?? "{}"));

    expect(String(pageFetches[1]?.[0])).toContain("/browser-rendering/scrape");
    expect(scrapeRequest.elements).toEqual([
      {
        selector: 'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]',
      },
    ]);
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        platforms: expect.arrayContaining(["Instagram", "Facebook"]),
        source: "meta_library_browser",
      }),
    ]);
  });

  it("classifies Quick Actions 429 errors as rate limited", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
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
      ) as never,
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
