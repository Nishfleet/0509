import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromiseTimeoutError } from "~/lib/fetch-timeout.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
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
        new Response("<html><head><title>Raw page</title></head><body>Raw offer. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>", {
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
      expect.objectContaining({
        jobId: expect.any(String),
        routeContext: "selection_enrichment",
        planTier: null,
        source: "unknown",
      }),
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

  it("refuses an HTML-only HTTP fallback when requireScreenshot is true", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const onFailure = vi.fn();
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { preferRendered: true, requireScreenshot: true, onFailure },
    );

    expect(snapshot).toBeNull();
    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/glow",
      expect.objectContaining({ requireScreenshot: true }),
    );
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "screenshot_required" }),
    );
    expect(nonDnsFetchCalls(fetch)).toHaveLength(0);
  });

  it("refuses a rendered snapshot that has HTML but no screenshot artifact", async () => {
    mockFetchWithDns(vi.fn(async () => new Response("ok", { status: 200 })) as never);
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/glow",
      canonicalUrl: "https://example.com/glow",
      rawHeadline: "Rendered offer",
      normalizedHeadline: "rendered offer",
      normalizedHeadlineHash: "hash",
      ctaText: "Shop now",
      priceText: "$10",
      formPresent: false,
      captureMethod: "browser_render",
      capturedAt: "2026-06-05T00:00:00.000Z",
      artifactKey: "landing-pages/rendered.html",
      metadata: {
        htmlArtifactKey: "landing-pages/rendered.html",
        screenshotArtifactKey: null,
      },
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const onFailure = vi.fn();
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { preferRendered: true, requireScreenshot: true, onFailure },
    );

    expect(snapshot).toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "screenshot_required" }),
    );
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
            <p>Starting at ₹499 only today. Our best-selling vitamin C serum is now at 20% off for the launch week. Free shipping on all orders above ₹999.</p>
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
        extractorVersion: "lp-signals-v5",
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
        "<html><head><title>Readable render</title></head><body><button>Buy now</button><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
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
        "<html><head><title>Oversized screenshot proof</title></head><body><button>Buy now</button><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
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
                      <p>Up to 30% off this week. Our best-selling vitamin C serum is on launch sale with free shipping on all orders above the free-shipping threshold.</p>
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
            html: { html: "<html><head><title>Proof</title></head><body><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>" },
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
      expect.objectContaining({
        jobId: expect.any(String),
        routeContext: "selection_enrichment",
        planTier: null,
        source: "unknown",
      }),
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
              html: { html: "<html><head><title>Huge proof</title></head><body><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>" },
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
                html: "<html><head><title>Decoded proof</title></head><body><a>Buy now</a><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
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

describe("captureLandingPageSnapshot plain_http attribution rows", () => {
  function telemetryEnv(db: unknown) {
    return { DB: db } as never;
  }

  it("records a succeeded plain_http row for a fetched landing page", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body>Real offer details here. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      telemetryEnv(harness.db),
      "https://example.com/offer",
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "landing_snapshot",
      actual_provider: "plain_http",
      route_context: "selection_enrichment",
      source: "unknown",
      plan_tier: null,
      outcome: "succeeded",
      result_count: 1,
    });
    expect(Number(rows[0].result_bytes)).toBeGreaterThan(0);
    expect(String(rows[0].idempotency_key)).toMatch(/^[0-9a-f]{64}:plain_http$/u);
    harness.close();
  });

  it("records a blocked plain_http row with proof_capture/scheduled context", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    const onFailure = vi.fn();

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      telemetryEnv(harness.db),
      "https://example.com/blocked",
      { onFailure, allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "landing_blocked" }),
    );
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "landing_snapshot",
      actual_provider: "plain_http",
      route_context: "proof_capture",
      source: "scheduled",
      outcome: "blocked",
      result_count: null,
    });
    harness.close();
  });
});

describe("landing attribution outcome and attempt fidelity", () => {
  function telemetryEnv(db: unknown) {
    return { DB: db } as never;
  }

  it("maps an HTTP 429 fetch to the rate_limited outcome", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("slow down", { status: 429 })) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    const onFailure = vi.fn();

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      telemetryEnv(harness.db),
      "https://example.com/limited",
      { onFailure, allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "landing_rate_limited" }),
    );
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "landing_snapshot",
      actual_provider: "plain_http",
      outcome: "rate_limited",
    });
    harness.close();
  });

  it("maps a plain-http fetch timeout to the timeout outcome", async () => {
    mockFetchWithDns(
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    const onFailure = vi.fn();

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      telemetryEnv(harness.db),
      "https://example.com/slow",
      { onFailure, allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    // Customer-visible reasonCode stays honest and unchanged; only the
    // telemetry outcome is the truthful timeout class.
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "landing_fetch_failed" }),
    );
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_kind: "landing_snapshot",
      actual_provider: "plain_http",
      outcome: "timeout",
    });
    harness.close();
  });

  it("records ordered attempts: failed plain-http leg BEFORE the rendered fallback", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );
    // Real browser-run path (no module mock): the rendered leg records its
    // own row with the attempt number landing-pages assigns to it.
    const page = {
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue(undefined),
      content: vi.fn().mockResolvedValue(
        "<html><head><title>Gated offer</title></head><body>Rendered offer body. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
      ),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {
        launch: vi.fn().mockResolvedValue(browser),
        sessions: vi.fn().mockResolvedValue([]),
        limits: vi.fn().mockResolvedValue({
          activeSessions: [],
          maxConcurrentSessions: 2,
          allowedBrowserAcquisitions: 1,
          timeUntilNextAllowedBrowserAcquisition: 0,
        }),
        connect: vi.fn(),
      },
    }));

    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      { BROWSER: {} as Fetcher, DB: harness.db } as never,
      "https://example.com/gated",
      { allowRenderedFallback: true, persistArtifacts: false },
    );

    expect(snapshot?.captureMethod).toBe("browser_render");
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // One job, one job id, ordered attempts, no duplicate plain-http row.
    expect(rows[0].job_id).toBe(rows[1].job_id);
    expect(rows[0]).toMatchObject({
      actual_provider: "plain_http",
      attempt: 1,
      outcome: "blocked",
    });
    expect(rows[1]).toMatchObject({
      actual_provider: "cloudflare_browser_run",
      attempt: 2,
      outcome: "succeeded",
      result_count: 1,
    });
    expect(String(rows[1].idempotency_key)).toMatch(/^[0-9a-f]{64}:cloudflare_browser_run$/u);
    expect(String(rows[0].idempotency_key)).toMatch(/^[0-9a-f]{64}:plain_http$/u);
    harness.close();
  });

  it("records a single plain-http row when the rendered fallback also fails", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    const onFailure = vi.fn();

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      telemetryEnv(harness.db),
      "https://example.com/gated",
      { onFailure, allowRenderedFallback: true },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actual_provider: "plain_http",
      attempt: 1,
      outcome: "blocked",
    });
    harness.close();
  });
});

describe("rendered chain attempt ordering and job correlation", () => {
  function telemetryHarness() {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    return harness;
  }

  it("keeps one job id with ordered attempts across plain_http → Browser Run → Browserless", async () => {
    // plain-http fetch fails (403), Browser Run launch fails, Browserless BQL
    // succeeds: every leg must record under the SAME job id with distinct,
    // ordered attempt numbers.
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response(
            JSON.stringify({
              data: {
                html: {
                  html: `
                    <html>
                      <head><title>Rendered proof</title></head>
                      <body><button>Shop now</button><p>Only today. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body>
                    </html>
                  `,
                },
                screenshot: { base64: btoa("1234") },
                documentRequests: [{ url: "https://www.example.com/glow" }],
                url: { url: "https://www.example.com/glow" },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {
        launch: vi.fn().mockRejectedValue(new Error("browser launch exploded")),
      },
    }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSER: {} as Fetcher,
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/glow",
      { persistArtifacts: false },
    );

    expect(snapshot?.captureMethod).toBe("browser_render");
    expect(snapshot?.metadata).toMatchObject({ renderProvider: "browserless_bql" });
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.job_id)).size).toBe(1);
    expect(rows.map((row) => row.attempt)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.actual_provider)).toEqual([
      "plain_http",
      "cloudflare_browser_run",
      "browserless_bql",
    ]);
    expect(rows[0]).toMatchObject({ outcome: "blocked" });
    expect(rows[1]).toMatchObject({ outcome: "failed" });
    expect(rows[2]).toMatchObject({ outcome: "succeeded", result_count: 1 });
    for (const row of rows) {
      expect(Math.abs(
        Number(row.duration_ms) -
          (Date.parse(String(row.ended_at)) - Date.parse(String(row.started_at))),
      )).toBeLessThanOrEqual(2);
    }
    harness.close();
  });

  it("continues the attempt chain when the Browser Run binding never runs", async () => {
    // No BROWSER binding: the Browser Run leg records nothing, so Browserless
    // must continue after the failed plain-http leg (attempt 2) instead of
    // colliding with it — and never claim attempt 1.
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response(
            JSON.stringify({
              data: {
                html: {
                  html: `
                    <html>
                      <head><title>Rendered proof</title></head>
                      <body><button>Shop now</button><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body>
                    </html>
                  `,
                },
                screenshot: { base64: btoa("1234") },
                documentRequests: [{ url: "https://www.example.com/glow" }],
                url: { url: "https://www.example.com/glow" },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/glow",
      { persistArtifacts: false },
    );

    expect(snapshot?.captureMethod).toBe("browser_render");
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.job_id)).size).toBe(1);
    expect(rows.map((row) => row.actual_provider)).toEqual(["plain_http", "browserless_bql"]);
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
    harness.close();
  });

  it("never blocks the landing capture on a slow or failing telemetry write", async () => {
    // The product path must complete even when every D1 telemetry write hangs
    // past the bounded cap: the capture still returns its snapshot quickly.
    const hangingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () => new Promise<never>(() => undefined),
            };
          },
        };
      },
    } as unknown as D1Database;
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body>Real offer details here. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const startedAt = Date.now();
    const snapshot = await captureLandingPageSnapshot(
      { DB: hangingDb } as never,
      "https://example.com/offer",
    );

    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("registers slow telemetry writes with waitUntil without delaying the capture", async () => {
    // With a caller-supplied ExecutionContext, the bounded write race still
    // caps the wait while the never-settling write is handed to waitUntil for
    // background completion — the capture completes and never throws.
    const hangingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () => new Promise<never>(() => undefined),
            };
          },
        };
      },
    } as unknown as D1Database;
    const waitUntil = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body>Real offer details here. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const startedAt = Date.now();
    const snapshot = await captureLandingPageSnapshot(
      { DB: hangingDb } as never,
      "https://example.com/offer",
      { executionContext: { waitUntil } as unknown as ExecutionContext },
    );

    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it("never throws or delays the capture when a registered telemetry write rejects", async () => {
    // A D1 write that REJECTS (provider down) must not surface to the product
    // path: with a caller-supplied ExecutionContext the failing write is still
    // handed to waitUntil for background completion, the bounded race never
    // waits on it, and the capture returns its snapshot without throwing.
    const rejectingDb = {
      prepare() {
        return {
          bind() {
            return {
              run: () => Promise.reject(new Error("d1 write exploded")),
            };
          },
        };
      },
    } as unknown as D1Database;
    const waitUntil = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body>Real offer details here. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const startedAt = Date.now();
    await expect(
      captureLandingPageSnapshot(
        { DB: rejectingDb } as never,
        "https://example.com/offer",
        { executionContext: { waitUntil } as unknown as ExecutionContext },
      ),
    ).resolves.toMatchObject({ captureMethod: "landing_page_fetch" });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    // The registered background write settles (the writer swallows the D1
    // error), so awaiting it never throws.
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });
});

describe("rendered leg provider-error fidelity", () => {
  function telemetryHarness() {
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");
    return harness;
  }

  it("maps a Browser Run launch timeout to the timeout outcome", async () => {
    // plain-http fails (403) so the rendered chain runs; the Browser Run
    // leg's launch hits the bounded timeout (PromiseTimeoutError) and must
    // be attributed `timeout`, not a generic failure.
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 403 })) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {
        launch: vi.fn().mockRejectedValue(
          new PromiseTimeoutError("Browser Run launch timed out."),
        ),
      },
    }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      { BROWSER: {} as Fetcher, DB: harness.db } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actual_provider: "plain_http", outcome: "blocked" });
    expect(rows[1]).toMatchObject({
      actual_provider: "cloudflare_browser_run",
      outcome: "timeout",
    });
    harness.close();
  });

  it("maps a Browserless provider 429 to the rate_limited outcome", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response("rate limited", { status: 429 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ actual_provider: "plain_http", outcome: "blocked" });
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    harness.close();
  });

  it("maps a Browserless fetch abort to the timeout outcome", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          throw new DOMException("aborted", "AbortError");
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ actual_provider: "plain_http", outcome: "blocked" });
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "timeout",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "timeout",
    });
    harness.close();
  });

  it("classifies an EMPTY 429 Browserless body as rate_limited before body parsing", async () => {
    // The provider status is the ground truth: an error-status response with
    // no readable body must NOT degrade to a generic `failed` empty-body row.
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response(null, { status: 429 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    harness.close();
  });

  it("classifies a MALFORMED 429 Browserless body as rate_limited before JSON parsing", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response("this is not json", { status: 429 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "rate_limited",
    });
    harness.close();
  });

  it("classifies an EMPTY 408 Browserless body as timeout before body parsing", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response(null, { status: 408 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "timeout",
    });
    harness.close();
  });

  it("classifies a MALFORMED 504 Browserless body as timeout before JSON parsing", async () => {
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response("{broken", { status: 504 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "timeout",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "timeout",
    });
    harness.close();
  });

  it("keeps an EMPTY 500 Browserless body as a bounded failed row (not a provider class)", async () => {
    // Statuses outside the rate-limit/timeout family stay `failed` even when
    // the body is empty — only 429/408/504 get provider-specific outcomes.
    mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("browserless.io/stealth/bql")) {
          return new Response(null, { status: 500 });
        }
        return new Response("blocked", { status: 403 });
      }) as never,
    );
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));

    const harness = telemetryHarness();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        DB: harness.db,
      } as never,
      "https://example.com/gated",
      { persistArtifacts: false },
    );

    expect(snapshot).toBeNull();
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry ORDER BY attempt ASC")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "failed",
    });
    expect(rows[2]).toMatchObject({
      actual_provider: "browserless_bql",
      outcome: "failed",
    });
    harness.close();
  });
});

describe("rendered-first duration origin (controlled clock)", () => {
  it("starts the plain-http leg after a failed rendered-first attempt", async () => {
    // preferRendered runs the rendered leg first; it fails after consuming
    // 3s of clock. The plain-http leg that follows must record its OWN start
    // immediately before the fetch — never the job start — so the rendered
    // time is excluded from the HTTP duration.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Offer</title></head><body>Real offer details here. Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot: vi.fn(async () => {
        vi.advanceTimersByTime(3_000);
        return null;
      }),
    }));

    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0076_browser_job_telemetry.sql");

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      { DB: harness.db } as never,
      "https://example.com/offer",
      { preferRendered: true },
    );

    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    const rows = harness.sqlite
      .prepare("SELECT * FROM browser_job_telemetry")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actual_provider: "plain_http",
      outcome: "succeeded",
      // The HTTP leg started AFTER the 3s rendered block, and its duration is
      // the HTTP window only (0ms), never the job-spanning 3000ms.
      started_at: "2026-08-13T12:00:03.000Z",
      duration_ms: 0,
    });
    vi.useRealTimers();
    harness.close();
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
          '<html><head><title>Retried page</title></head><body><a href="/buy">Buy now</a><p>$49</p><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>',
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
        "<html><head><title>SPA hydrated</title></head><body><button>Book now</button><form><input name=\"email\" /></form><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
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
                html: "<html><head><title>Retried render</title></head><body><a>Claim deal</a><p>Our best-selling serum is now at 20% off for the launch week. Starting at ₹499 with free shipping on all orders above ₹999.</p></body></html>",
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
