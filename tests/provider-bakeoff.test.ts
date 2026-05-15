import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeMetaLibraryHtml,
  buildBrowserlessBqlRequest,
  buildBrightDataWsUrl,
  buildBrowserbaseSessionRequest,
  buildBrowserbaseSessionReleaseRequest,
  buildCurrent0509SearchUrl,
  buildMetaLibraryUrl,
  buildZyteRequest,
  DOGFOOD_QUERIES,
  findBlockingCurrent0509Failures,
  runBrightDataProbe,
  runBrowserbaseProbe,
  runBrowserlessBqlProbe,
  runCurrent0509Probe,
  runZyteProbe,
} from "../scripts/provider-bakeoff.lib.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider bakeoff helpers", () => {
  it("keeps known ad-heavy production search samples in the default gate", () => {
    expect(DOGFOOD_QUERIES).toEqual(
      expect.arrayContaining(["nykaa", "boat", "mamaearth", "swiggy", "zomato", "meesho"]),
    );
  });

  it("builds the same advertiser Meta Ad Library URL shape as production", () => {
    expect(
      buildMetaLibraryUrl({
        query: "adspy",
        country: "India",
        mode: "advertiser",
      }),
    ).toBe(
      "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&is_targeted_country=false&media_type=all&search_type=keyword_exact_phrase&q=adspy",
    );
  });

  it("builds the current 0509 public search URL", () => {
    expect(
      buildCurrent0509SearchUrl({
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      }),
    ).toBe("https://0509.in/search?query=bigspy&country=India&mode=advertiser");
  });

  it("builds the Browserbase session request", () => {
    const request = buildBrowserbaseSessionRequest(
      {
        provider: "browserbase",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: "proj_123",
        BROWSERBASE_VERIFIED: "true",
      },
    );

    expect(request.endpoint).toBe("https://api.browserbase.com/v1/sessions");
    expect(request.headers["x-bb-api-key"]).toBe("bb-key");
    expect(request.body.projectId).toBe("proj_123");
    expect(request.body.proxies).toBe(true);
    expect(request.body.browserSettings?.verified).toBe(true);
  });

  it("builds the Browserbase session release request", () => {
    const request = buildBrowserbaseSessionReleaseRequest("sess_123", {
      BROWSERBASE_API_KEY: "bb-key",
      BROWSERBASE_PROJECT_ID: "proj_123",
    });

    expect(request).toEqual({
      endpoint: "https://api.browserbase.com/v1/sessions/sess_123",
      headers: {
        "content-type": "application/json",
        "x-bb-api-key": "bb-key",
      },
      body: {
        status: "REQUEST_RELEASE",
        projectId: "proj_123",
      },
    });
  });

  it("builds the Bright Data websocket URL from credentials", () => {
    expect(
      buildBrightDataWsUrl({
        BRIGHT_DATA_USERNAME: "user",
        BRIGHT_DATA_PASSWORD: "pass",
      }),
    ).toBe("wss://user:pass@brd.superproxy.io:9222");
  });

  it("builds the Zyte browser request with viewport and wait action", () => {
    const request = buildZyteRequest(
      {
        provider: "zyte_api",
        query: "adflex",
        country: "India",
        mode: "advertiser",
      },
      {
        ZYTE_API_KEY: "zyte-key",
      },
    );

    expect(request.endpoint).toBe("https://api.zyte.com/v1/extract");
    expect(request.body.viewport).toEqual({
      width: 390,
      height: 844,
    });
    expect(request.body.actions?.[0]).toEqual({
      action: "waitForSelector",
      selector: {
        type: "css",
        value: 'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]',
        state: "attached",
      },
    });
  });

  it("analyzes duplicate ad library links and degraded state honestly", () => {
    const analysis = analyzeMetaLibraryHtml(`
      <html>
        <body>
          <div>Source: Cached live results</div>
          <div>Commercial discovery degraded</div>
          <a href="https://www.facebook.com/ads/library/?id=123">one</a>
          <a href="/ads/library/?id=123">duplicate</a>
          <a href="/ads/library/?id=456">two</a>
        </body>
      </html>
    `);

    expect(analysis.matchCount).toBe(2);
    expect(analysis.libraryIds).toEqual(["123", "456"]);
    expect(analysis.degraded).toBe(true);
    expect(analysis.sourceLabel).toBe("Cached live results");
  });

  it("detects login walls and rate limits from rendered HTML", () => {
    const blocked = analyzeMetaLibraryHtml("<html><body>Facebook Log in to continue</body></html>");
    const rateLimited = analyzeMetaLibraryHtml("<html><body>Try again later, rate limit hit</body></html>");

    expect(blocked.loginWall).toBe(true);
    expect(rateLimited.rateLimited).toBe(true);
  });

  it("returns blocking current 0509 failures for the CLI gate", () => {
    const failures = findBlockingCurrent0509Failures([
      {
        provider: "current_0509",
        query: "nykaa",
        country: "India",
        mode: "advertiser",
        status: "empty",
        latencyMs: 1,
        httpStatus: 200,
        siteStatus: null,
        matchCount: 0,
        loginWall: false,
        rateLimited: false,
        blockedLikely: false,
        degraded: false,
        sourceLabel: "Cached live results",
        url: "https://0509.in/search?query=nykaa",
        note: null,
      },
      {
        provider: "browserbase",
        query: "nykaa",
        country: "India",
        mode: "advertiser",
        status: "skipped",
        latencyMs: 1,
        httpStatus: null,
        siteStatus: null,
        matchCount: 0,
        loginWall: false,
        rateLimited: false,
        blockedLikely: false,
        degraded: false,
        sourceLabel: null,
        url: "https://www.facebook.com/ads/library/",
        note: "Missing credentials",
      },
    ]);

    expect(failures).toHaveLength(1);
    expect(failures[0].query).toBe("nykaa");
  });
});

describe("browserless probe", () => {
  it("skips cleanly when the token is missing", async () => {
    const result = await runBrowserlessBqlProbe(
      {
        provider: "browserless_bql",
        query: "adflex",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {},
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.note).toContain("BROWSERLESS_TOKEN");
  });

  it("builds a stealth Browserless endpoint by default", () => {
    const request = buildBrowserlessBqlRequest(
      {
        provider: "browserless_bql",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        BROWSERLESS_TOKEN: "test-token",
      },
    );

    expect(request.endpoint).toBe("https://production-sfo.browserless.io/stealth/bql?token=test-token");
    expect(request.body.variables.url).toContain("q=adspy");
    expect("selector" in request.body.variables).toBe(false);
    expect(request.body.query).toContain("waitForTimeout");
  });

  it("parses a successful Browserless HTML response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          goto: {
            status: 200,
          },
          html: {
            html: `
              <html>
                <body>
                  <a href="https://www.facebook.com/ads/library/?id=999">ad</a>
                </body>
              </html>
            `,
          },
        },
      }),
    });

    const result = await runBrowserlessBqlProbe(
      {
        provider: "browserless_bql",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          BROWSERLESS_TOKEN: "test-token",
        },
        fetchImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.matchCount).toBe(1);
    expect(result.siteStatus).toBe(200);
  });
});

describe("browser session providers", () => {
  it("skips Browserbase when credentials are missing", async () => {
    const result = await runBrowserbaseProbe(
      {
        provider: "browserbase",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {},
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.note).toContain("BROWSERBASE_API_KEY");
  });

  it("runs a Browserbase probe when the session API returns a connectUrl", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "sess_123",
          connectUrl: "wss://connect.browserbase.test",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    const extractCdpImpl = vi.fn().mockResolvedValue({
      html: `<html><body><a href="/ads/library/?id=222">ad</a></body></html>`,
      pageState: {
        hasSelector: true,
        readyState: "complete",
        loginWall: false,
        rateLimited: false,
        blockedLikely: false,
      },
    });

    const result = await runBrowserbaseProbe(
      {
        provider: "browserbase",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          BROWSERBASE_API_KEY: "bb-key",
          BROWSERBASE_PROJECT_ID: "proj_123",
        },
        fetchImpl,
        extractCdpImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.matchCount).toBe(1);
    expect(extractCdpImpl).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api.browserbase.com/v1/sessions/sess_123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          status: "REQUEST_RELEASE",
          projectId: "proj_123",
        }),
      }),
    );
  });

  it("reports Browserbase release failures without hiding the probe result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "sess_123",
          connectUrl: "wss://connect.browserbase.test",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "release failed" }),
      });
    const extractCdpImpl = vi.fn().mockResolvedValue({
      html: `<html><body><a href="/ads/library/?id=222">ad</a></body></html>`,
      pageState: {
        hasSelector: true,
        readyState: "complete",
        loginWall: false,
        rateLimited: false,
        blockedLikely: false,
      },
    });

    const result = await runBrowserbaseProbe(
      {
        provider: "browserbase",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          BROWSERBASE_API_KEY: "bb-key",
          BROWSERBASE_PROJECT_ID: "proj_123",
        },
        fetchImpl,
        extractCdpImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.note).toContain("Browserbase session release failed");
  });

  it("classifies Browserbase too-many-requests errors as rate limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        message: "Too many requests",
      }),
    });

    const result = await runBrowserbaseProbe(
      {
        provider: "browserbase",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          BROWSERBASE_API_KEY: "bb-key",
          BROWSERBASE_PROJECT_ID: "proj_123",
        },
        fetchImpl,
      },
    );

    expect(result.status).toBe("rate_limited");
    expect(result.rateLimited).toBe(true);
    expect(result.note).toBe("Too many requests");
  });

  it("classifies Zyte too-many-requests errors as rate limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        message: "Too many requests",
      }),
    });

    const result = await runZyteProbe(
      {
        provider: "zyte_api",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          ZYTE_API_KEY: "zyte-key",
        },
        fetchImpl,
      },
    );

    expect(result.status).toBe("rate_limited");
    expect(result.rateLimited).toBe(true);
    expect(result.note).toBe("Too many requests");
  });

  it("skips Bright Data when credentials are missing", async () => {
    const result = await runBrightDataProbe(
      {
        provider: "brightdata",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {},
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.note).toContain("BRIGHT_DATA_BROWSER_WS");
  });

  it("runs a Bright Data probe when a websocket endpoint is provided", async () => {
    const extractCdpImpl = vi.fn().mockResolvedValue({
      html: `<html><body><a href="https://www.facebook.com/ads/library/?id=333">ad</a></body></html>`,
      pageState: {
        hasSelector: true,
        readyState: "complete",
        loginWall: false,
        rateLimited: false,
        blockedLikely: false,
      },
    });

    const result = await runBrightDataProbe(
      {
        provider: "brightdata",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          BRIGHT_DATA_BROWSER_WS: "wss://user:pass@brd.superproxy.io:9222",
        },
        extractCdpImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.matchCount).toBe(1);
    expect(extractCdpImpl).toHaveBeenCalled();
  });
});

describe("zyte probe", () => {
  it("skips when the key is missing", async () => {
    const result = await runZyteProbe(
      {
        provider: "zyte_api",
        query: "adflex",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {},
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.note).toContain("ZYTE_API_KEY");
  });

  it("parses a successful Zyte browser response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        browserHtml: `<html><body><a href="/ads/library/?id=444">ad</a></body></html>`,
        actions: [],
      }),
    });

    const result = await runZyteProbe(
      {
        provider: "zyte_api",
        query: "adflex",
        country: "India",
        mode: "advertiser",
      },
      {
        env: {
          ZYTE_API_KEY: "zyte-key",
        },
        fetchImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.matchCount).toBe(1);
  });
});

describe("current 0509 probe", () => {
  it("bounds production search probes with an abort timeout", async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: Live Ad Library capture</div>
            <h2>1 ads on this page</h2>
          </body>
        </html>
      `,
    });

    await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
        timeoutMs: 1234,
      },
    );

    expect(timeoutSpy).toHaveBeenCalledWith(1234);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("captures the live source label from rendered HTML", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: Live Ad Library capture</div>
            <h2>3 ads on this page</h2>
          </body>
        </html>
      `,
    });

    const result = await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.sourceLabel).toBe("Live Ad Library capture");
    expect(result.matchCount).toBe(3);
  });

  it("captures the source label from the rendered search pill", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div class="source-pill">Meta ads beta · Live Ad Library capture</div>
            <h2>3 ads on this page</h2>
          </body>
        </html>
      `,
    });

    const result = await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.sourceLabel).toBe("Live Ad Library capture");
    expect(result.matchCount).toBe(3);
  });

  it("uses the longer production timeout for fresh live probes", async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div class="source-pill">Meta ads beta · Live Ad Library capture</div>
            <h2>3 ads on this page</h2>
          </body>
        </html>
      `,
    });

    await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
        forceLive: true,
      },
    );

    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
  });

  it("sends the tokened fresh-live bypass for canary probes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: Live Ad Library capture</div>
            <h2>3 ads on this page</h2>
          </body>
        </html>
      `,
    });

    await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
        forceLive: true,
        canaryBypassToken: "secret-token",
      },
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("fresh=live");
    expect(init?.headers).toMatchObject({
      "x-0509-canary-token": "secret-token",
    });
  });

  it("treats API fallback pages with rendered results as healthy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: API fallback</div>
            <h2>2 ads on this page</h2>
          </body>
        </html>
      `,
    });

    const result = await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.sourceLabel).toBe("API fallback");
    expect(result.matchCount).toBe(2);
  });

  it("treats cached live zero-result pages as empty instead of success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: Cached live results</div>
            <h2>0 ads on this page</h2>
            <div>No ads found for this query</div>
          </body>
        </html>
      `,
    });

    const result = await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "adspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
      },
    );

    expect(result.status).toBe("empty");
    expect(result.sourceLabel).toBe("Cached live results");
    expect(result.matchCount).toBe(0);
    expect(result.note).toContain("zero rendered results");
  });

  it("treats Demo dataset source label as error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <html>
          <body>
            <div>Source: Demo dataset</div>
            <h2>5 ads on this page</h2>
          </body>
        </html>
      `,
    });

    const result = await runCurrent0509Probe(
      {
        provider: "current_0509",
        query: "bigspy",
        country: "India",
        mode: "advertiser",
      },
      {
        fetchImpl,
      },
    );

    expect(result.status).toBe("error");
    expect(result.sourceLabel).toBe("Demo dataset");
  });
});
