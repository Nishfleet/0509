import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/browser-run.server");
});

function mockFetchWithDns(
  handler: typeof fetch,
  records: Record<string, { A?: string[]; AAAA?: string[] }> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const hostname = parsed.searchParams.get("name") ?? "";
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = records[hostname]?.[type] ?? (type === "A" ? ["93.184.216.34"] : []);
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

describe("captureLandingPageSnapshot Browser Run fallback", () => {
  it("rejects private initial URLs before fetch or render", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    for (const url of [
      "http://127.0.0.1/admin",
      "http://[::ffff:127.0.0.1]/admin",
      "http://[::ffff:7f00:1]/admin",
      "http://[::ffff:a9fe:a9fe]/metadata",
    ]) {
      await expect(
        captureLandingPageSnapshot({ BROWSERLESS_TOKEN: "browserless-token" }, url),
      ).resolves.toBeNull();
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects public-looking hostnames that resolve to private addresses", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () => new Response("ok")) as never,
      {
        "127.0.0.1.nip.io": {
          A: ["127.0.0.1"],
        },
      },
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot(
        { BROWSERLESS_TOKEN: "browserless-token" },
        "http://127.0.0.1.nip.io/admin",
      ),
    ).resolves.toBeNull();

    expect(nonDnsFetchCalls(fetch)).toHaveLength(0);
  });

  it("does not follow redirects to private URLs", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1/admin",
          },
        }),
      ) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot({ BROWSERLESS_TOKEN: "browserless-token" }, "https://example.com/start"),
    ).resolves.toBeNull();

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("prefers rendered proof before static fetch after public URL validation", async () => {
    const put = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response("<html><head><title>Raw page</title></head><body>Raw offer</body></html>", {
          status: 200,
        }),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/glow",
      canonicalUrl: "https://example.com/glow",
      rawHeadline: "Rendered offer",
      normalizedHeadline: "rendered offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Claim rendered deal",
      priceText: "Rendered price",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-06-05T00:00:00.000Z",
      artifactKey: "landing-pages/rendered.html",
      metadata: {
        screenshotArtifactKey: "landing-pages/rendered.jpeg",
      },
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      { LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket },
      "https://example.com/glow",
      { preferRendered: true },
    );

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/glow",
    );
    expect(snapshot).toMatchObject({
      captureMethod: "browser_render",
      rawHeadline: "Rendered offer",
      metadata: expect.objectContaining({
        screenshotArtifactKey: "landing-pages/rendered.jpeg",
      }),
    });
    expect(put).not.toHaveBeenCalled();
    expect(nonDnsFetchCalls(fetch)).toHaveLength(0);
  });

  it("does not repeat a failed rendered-first attempt after a blocked static fetch", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const onFailure = vi.fn();
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/blocked",
      { onFailure, preferRendered: true },
    );

    expect(snapshot).toBeNull();
    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "landing_blocked",
      }),
    );
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("renders a successful but signal-empty HTML shell before accepting it as evidence", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          '<html><head><title>Glow serum</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Hydrated launch offer",
      normalizedHeadline: "hydrated launch offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-07-30T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      rawHeadline: "Hydrated launch offer",
      ctaText: "Buy now",
      captureMethod: "browser_render",
    });
  });

  it("renders an SPA shell whose root contains only a loading placeholder", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          '<html><head><title>Glow serum</title></head><body><div id="root">Loading…</div><script src="/app.js"></script></body></html>',
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Hydrated launch offer",
      normalizedHeadline: "hydrated launch offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-07-30T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      rawHeadline: "Hydrated launch offer",
      ctaText: "Buy now",
      captureMethod: "browser_render",
    });
  });

  it("ignores noscript boilerplate when deciding whether a page is an SPA shell", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          '<html><head><title>Glow serum</title></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div><script src="/app.js"></script></body></html>',
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Hydrated launch offer",
      normalizedHeadline: "hydrated launch offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-07-30T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      ctaText: "Buy now",
      captureMethod: "browser_render",
    });
  });

  it("ignores XHTML-style noscript boilerplate when deciding whether a page is an SPA shell", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          '<html><head><title>Glow serum</title></head><body><noscript/>You need to enable JavaScript to run this app.</noscript><div id="root"></div><script src="/app.js"></script></body></html>',
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Hydrated launch offer",
      normalizedHeadline: "hydrated launch offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-07-30T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      ctaText: "Buy now",
      captureMethod: "browser_render",
    });
  });

  it("renders a body-empty SPA shell with only a bare form wrapper", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          '<html><head><title>Glow serum</title></head><body><form id="root"></form><script src="/app.js"></script></body></html>',
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      rawHeadline: "Hydrated launch offer",
      normalizedHeadline: "hydrated launch offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-07-30T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      ctaText: "Buy now",
      formPresent: true,
      captureMethod: "browser_render",
    });
  });

  it("captures a real browser-rendered proof bundle when fetch fails", async () => {
    mockFetchWithDns(vi.fn(async () => {
      throw new Error("fetch failed");
    }) as never);

    const page = {
      goto: vi.fn(),
      on: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      setViewport: vi.fn(),
      content: vi.fn().mockResolvedValue(`
        <html>
          <head>
            <title>Glow Serum Sale</title>
          </head>
          <body>
            <button>Shop now</button>
            <p>Starting at ₹499 only today</p>
            <form action="/lead">
              <input name="phone" />
              <input type="submit" value="Get Offer" />
            </form>
          </body>
        </html>
      `),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      url: vi.fn().mockReturnValue("https://example.com/glow?ref=browser"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    const put = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch },
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSER: {} as Fetcher,
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith("https://example.com/glow", expect.any(Object));
    expect(snapshot).toMatchObject({
      rawHeadline: "Glow Serum Sale",
      normalizedHeadlineHash: expect.any(String),
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
      captureMethod: "browser_render",
      artifactKey: expect.stringContaining(".html"),
      metadata: expect.objectContaining({
        htmlArtifactKey: expect.stringContaining(".html"),
        screenshotArtifactKey: expect.stringContaining(".jpeg"),
        renderMode: "mobile",
        deviceProfile: "mobile_default",
        renderProvider: "cloudflare_browser_run",
        extractorVersion: "lp-signals-v4",
        extractionWarnings: [],
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: 0.9,
          priceText: 0.85,
          formPresent: 0.9,
        },
      }),
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalled();
  });

  it("keeps rendered HTML signals when screenshot capture fails", async () => {
    mockFetchWithDns(vi.fn(async () => {
      throw new Error("fetch failed");
    }) as never);

    const page = {
      goto: vi.fn(),
      on: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      setViewport: vi.fn(),
      content: vi.fn().mockResolvedValue(
        "<html><head><title>Readable render</title></head><body><button>Buy now</button></body></html>",
      ),
      screenshot: vi.fn().mockRejectedValue(new Error("screenshot failed")),
      url: vi.fn().mockReturnValue("https://example.com/offer"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch: vi.fn().mockResolvedValue(browser) },
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      { BROWSER: {} as Fetcher },
      "https://example.com/offer",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Readable render",
      ctaText: "Buy now",
      metadata: {
        screenshotArtifactKey: null,
        captureWarningCodes: ["screenshot_capture_failed"],
      },
    });
  });

  it("keeps Browser Run HTML evidence when the screenshot artifact is oversized", async () => {
    const put = vi.fn();
    mockFetchWithDns(vi.fn(async () => {
      throw new Error("fetch failed");
    }) as never);

    const page = {
      goto: vi.fn(),
      on: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      setViewport: vi.fn(),
      content: vi.fn().mockResolvedValue(
        "<html><head><title>Oversized screenshot proof</title></head><body><button>Buy now</button></body></html>",
      ),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array(3_000_001)),
      url: vi.fn().mockReturnValue("https://example.com/offer"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch: vi.fn().mockResolvedValue(browser) },
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSER: {} as Fetcher,
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/offer",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Oversized screenshot proof",
      ctaText: "Buy now",
      metadata: {
        screenshotArtifactKey: null,
        htmlArtifactKey: expect.stringMatching(/\.html$/u),
        captureWarningCodes: ["screenshot_too_large"],
      },
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("returns null when Browser Run launch does not settle", async () => {
    vi.useFakeTimers();
    mockFetchWithDns(vi.fn(async () => {
      throw new Error("fetch failed");
    }) as never);
    const launch = vi.fn(() => new Promise(() => undefined));

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch },
    }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");

    const snapshot = captureBrowserRunSnapshot(
      { BROWSER: {} as Fetcher },
      "https://example.com/glow",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(snapshot).resolves.toBeNull();
    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    vi.useRealTimers();
  });

  it("uses Browserless as rendered proof fallback when fetch and Browser Run are unavailable", async () => {
    const screenshotBytes = new Uint8Array([8, 5, 0, 9]);
    const put = vi.fn().mockResolvedValue(undefined);
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <head>
                      <title>Nykaa onboarding bundle</title>
                    </head>
                    <body>
                      <a href="/offer">Claim deal</a>
                      <p>Up to 30% off this week</p>
                      <form>
                        <input name="email" />
                        <button type="submit">Submit</button>
                      </form>
                    </body>
                  </html>
                `,
              },
              screenshot: {
                base64: btoa(String.fromCharCode(...screenshotBytes)),
              },
              documentRequests: [
                {
                  url: "https://www.example.com/glow",
                },
              ],
              url: {
                url: "https://www.example.com/glow",
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    const pageFetches = nonDnsFetchCalls(fetch);
    // The static fetch fails twice (bounded transient retry), then the
    // rendered fallback runs and succeeds through Browserless.
    expect(pageFetches[0]).toEqual(["https://example.com/glow", expect.any(Object)]);
    expect(pageFetches[1]).toEqual(["https://example.com/glow", expect.any(Object)]);
    expect(pageFetches[2]).toEqual([
      expect.stringContaining("browserless.io/stealth/bql"),
      expect.objectContaining({
        method: "POST",
      }),
    ]);
	  expect(snapshot).toMatchObject({
	    rawHeadline: "Nykaa onboarding bundle",
	    ctaText: "Claim deal",
      priceText: "Up to 30% off",
      formPresent: true,
      captureMethod: "browser_render",
      canonicalUrl: "https://www.example.com/glow",
      metadata: expect.objectContaining({
        htmlArtifactKey: expect.stringContaining(".html"),
        screenshotArtifactKey: expect.stringContaining(".jpeg"),
        renderProvider: "browserless_bql",
      }),
	  });
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("keeps readable rendered evidence when HTML persistence fails", async () => {
    const screenshotBytes = new Uint8Array([8, 5, 0, 9]);
    const put = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("screenshot put failed"));
    const del = vi.fn().mockResolvedValue(undefined);
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }
        return new Response(JSON.stringify({
          data: {
            html: { html: "<html><head><title>Proof</title></head><body></body></html>" },
            screenshot: { base64: btoa(String.fromCharCode(...screenshotBytes)) },
            documentRequests: [{ url: "https://www.example.com/glow" }],
            url: { url: "https://www.example.com/glow" },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        LANDING_PAGE_ARTIFACTS: { put, delete: del } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Proof",
      artifactKey: null,
      metadata: {
        htmlArtifactKey: null,
        screenshotArtifactKey: expect.stringMatching(/\.jpeg$/u),
        captureWarningCodes: ["html_persistence_failed"],
      },
    });
    expect(put).toHaveBeenCalledTimes(2);
    const screenshotKey = String(put.mock.calls[0]?.[0]);
    expect(screenshotKey).toMatch(/\.jpeg$/u);
    expect(String(put.mock.calls[1]?.[0])).toMatch(/\.html$/u);
    expect(del).not.toHaveBeenCalled();
  });

  it("falls back to rendered capture when fetched HTML is over the byte limit", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(`<!doctype html><title>Huge page</title>${"A".repeat(1_000_001)}`, {
          status: 200,
        }),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/huge",
      canonicalUrl: "https://example.com/huge",
      rawHeadline: "Rendered huge page",
      normalizedHeadline: "rendered huge page",
      normalizedHeadlineHash: "hash-rendered-huge",
      ctaText: null,
      priceText: null,
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-06-15T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/huge");

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/huge",
    );
    expect(snapshot).toMatchObject({
      captureMethod: "browser_render",
      rawHeadline: "Rendered huge page",
    });
  });

  it("keeps Browserless HTML evidence when the screenshot artifact is oversized", async () => {
    const put = vi.fn();
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: { html: "<html><head><title>Huge proof</title></head><body></body></html>" },
              screenshot: { base64: `${"A".repeat(4_000_004)}` },
              documentRequests: [{ url: "https://www.example.com/glow" }],
              url: { url: "https://www.example.com/glow" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Huge proof",
      metadata: {
        screenshotArtifactKey: null,
        htmlArtifactKey: expect.stringMatching(/\.html$/u),
        captureWarningCodes: ["screenshot_too_large"],
      },
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("keeps Browserless HTML evidence when screenshot base64 is malformed", async () => {
    const put = vi.fn();
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: "<html><head><title>Decoded proof</title></head><body><a>Buy now</a></body></html>",
              },
              screenshot: { base64: "%%%truncated%%%" },
              documentRequests: [{ url: "https://www.example.com/glow" }],
              url: { url: "https://www.example.com/glow" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Decoded proof",
      ctaText: "Buy now",
      metadata: {
        screenshotArtifactKey: null,
        htmlArtifactKey: expect.stringMatching(/\.html$/u),
        captureWarningCodes: ["screenshot_decode_failed"],
      },
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

	it("does not send arbitrary proof URLs to Browserless without an allowlist", async () => {
	  const fetch = mockFetchWithDns(
	    vi.fn(async (input) => {
	      if (String(input).includes("browserless.io/stealth/bql")) {
	        return new Response(JSON.stringify({ data: {} }), { status: 200 });
	      }

	      throw new Error("fetch failed");
	    }) as never,
	  );

	  const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

	  await expect(
	    captureLandingPageSnapshot(
	      {
	        BROWSERLESS_TOKEN: "browserless-token",
	      },
	      "https://example.com/glow",
	    ),
	  ).resolves.toBeNull();

	  expect(nonDnsFetchCalls(fetch).some(([input]) => String(input).includes("browserless.io"))).toBe(false);
	});

	it("fails honestly when fetch fails and Browser Run is unavailable", async () => {
	  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(captureLandingPageSnapshot({}, "https://example.com/glow")).resolves.toBeNull();
  });

  it("contains a rejected rendered fallback after fetch failure", async () => {
    mockFetchWithDns(
      vi.fn(async () => {
        throw new Error("fetch failed");
      }) as never,
    );
    const captureRenderedLandingPageSnapshot = vi
      .fn()
      .mockRejectedValue(new Error("render failed"));
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot({}, "https://example.com/glow", { onFailure }),
    ).resolves.toBeNull();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      reasonCode: "landing_fetch_failed",
      metadata: {},
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"reasonCode":"rendered_fallback_failed"'),
    );
  });

  it("preserves an HTTP failure when its rendered fallback rejects", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("upstream failed", { status: 500 })) as never,
    );
    const captureRenderedLandingPageSnapshot = vi
      .fn()
      .mockRejectedValue(new Error("render failed"));
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot({}, "https://example.com/glow", { onFailure }),
    ).resolves.toBeNull();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      reasonCode: "landing_http_error",
      metadata: { fetchStatus: 500 },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"reasonCode":"rendered_fallback_failed"'),
    );
  });
});

describe("captureLandingPageSnapshot transient retry", () => {
  it("retries a transient HTTP 500 once and keeps the successful retry", async () => {
    let calls = 0;
    mockFetchWithDns(
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("boom", { status: 500 });
        }
        return new Response(
          '<html><head><title>Retried page</title></head><body><a href="/buy">Buy now</a><p>$49</p></body></html>',
          { status: 200 },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/retry");

    expect(calls).toBe(2);
    expect(snapshot).toMatchObject({
      rawHeadline: "Retried page",
      captureMethod: "landing_page_fetch",
      metadata: expect.objectContaining({ fetchAttempts: 2 }),
    });
  });

  it("does not retry a non-transient HTTP 403", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const onFailure = vi.fn();
    await expect(
      captureLandingPageSnapshot({}, "https://example.com/blocked", { onFailure }),
    ).resolves.toBeNull();

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "landing_blocked" }),
    );
  });

  it("escalates the goto wait strategy when a JS-heavy page never reaches network idle", async () => {
    mockFetchWithDns(
      vi.fn(async () => {
        throw new Error("fetch failed");
      }) as never,
    );
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("Timeout exceeded while waiting for networkidle2"))
        .mockResolvedValueOnce(undefined),
      on: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      setViewport: vi.fn(),
      content: vi.fn().mockResolvedValue(
        "<html><head><title>SPA hydrated</title></head><body><button>Book now</button><form><input name=\"email\" /></form></body></html>",
      ),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      url: vi.fn().mockReturnValue("https://example.com/spa"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch: vi.fn().mockResolvedValue(browser) },
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      { BROWSER: {} as Fetcher },
      "https://example.com/spa",
    );

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      "https://example.com/spa",
      expect.objectContaining({ waitUntil: "networkidle2" }),
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      "https://example.com/spa",
      expect.objectContaining({ waitUntil: "load" }),
    );
    expect(snapshot).toMatchObject({
      rawHeadline: "SPA hydrated",
      captureMethod: "browser_render",
      metadata: expect.objectContaining({
        pageLoadStrategy: "load",
        gotoAttempts: 2,
        renderProvider: "cloudflare_browser_run",
      }),
    });
  });

  it("retries a transient Browserless 5xx once and succeeds on the retry", async () => {
    let browserlessCalls = 0;
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }
        browserlessCalls += 1;
        if (browserlessCalls === 1) {
          return new Response("upstream failed", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: "<html><head><title>Retried render</title></head><body><a>Claim deal</a></body></html>",
              },
              screenshot: { base64: btoa(String.fromCharCode(1, 2, 3)) },
              documentRequests: [{ url: "https://www.example.com/glow" }],
              url: { url: "https://www.example.com/glow" },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
      },
      "https://example.com/glow",
    );

    expect(browserlessCalls).toBe(2);
    expect(snapshot).toMatchObject({
      rawHeadline: "Retried render",
      captureMethod: "browser_render",
      metadata: expect.objectContaining({ renderProvider: "browserless_bql" }),
    });
  });

  it("does not waste a Browserless retry on a permanent private canonical URL", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }
        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: "<html><head><title>Private redirect</title></head><body></body></html>",
              },
              documentRequests: [{ url: "https://www.example.com/glow" }],
              url: { url: "http://127.0.0.1/private" },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
      },
      "https://example.com/glow",
    );

    expect(snapshot).toBeNull();
  });
});
