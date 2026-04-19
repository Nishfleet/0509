import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("captureLandingPageSnapshot Browser Run fallback", () => {
  it("captures a real browser-rendered proof bundle when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const page = {
      goto: vi.fn(),
      setUserAgent: vi.fn(),
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
        extractorVersion: "lp-signals-v1",
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

  it("fails honestly when fetch fails and Browser Run is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(captureLandingPageSnapshot({}, "https://example.com/glow")).resolves.toBeNull();
  });
});
