import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bypass DNS / public-address resolution so captureBrowserRunSnapshot reaches
// the HTML parsing path with a deterministic URL.
vi.mock("~/lib/public-url.server", () => ({
  resolvePublicHttpUrl: vi.fn(async (value: string | URL) => new URL(value.toString())),
  resolvePublicRedirectUrl: vi.fn((location: string | null) => location ?? null),
  normalizePublicHttpUrl: vi.fn((value: string | URL) => new URL(value.toString())),
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@cloudflare/puppeteer");
});

function createPage(html: string, finalUrl: string) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(new Uint8Array([1])),
    url: vi.fn().mockReturnValue(finalUrl),
  };
}

describe("captureBrowserRunSnapshot decode wiring", () => {
  it("decodes the og:title headline entities once", async () => {
    const page = createPage(
      `<html><head><meta property="og:title" content="Tom &amp; Jerry &lt;3"></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
    const snapshot = await captureBrowserRunSnapshot(
      // No DB / no R2 bucket: telemetry and artifact persistence are no-ops.
      { BROWSER: {} as never } as never,
      "https://example.com/offer",
      { persistArtifacts: false },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("browser_render");
    // Single decode pass: &amp; -> &, &lt; -> <.
    expect(snapshot?.rawHeadline).toBe("Tom & Jerry <3");
  });

  it("does not double-decode an already-decoded ampersand in the headline", async () => {
    const page = createPage(
      `<html><head><meta property="og:title" content="a & b already decoded"></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
    const snapshot = await captureBrowserRunSnapshot(
      { BROWSER: {} as never } as never,
      "https://example.com/offer",
      { persistArtifacts: false },
    );

    expect(snapshot?.rawHeadline).toBe("a & b already decoded");
  });

  it("fails the rendered capture when screenshot is missing and requireScreenshot is true", async () => {
    const page = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    page.screenshot = vi.fn().mockRejectedValue(new Error("screenshot failed"));
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
    const snapshot = await captureBrowserRunSnapshot(
      { BROWSER: {} as never } as never,
      "https://example.com/offer",
      { requireScreenshot: true },
    );

    expect(snapshot).toBeNull();
    expect(page.screenshot).toHaveBeenCalledTimes(2);
  });

  it("persists a screenshot artifact when requireScreenshot is true", async () => {
    const page = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const put = vi.fn().mockResolvedValue(undefined);
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
    const snapshot = await captureBrowserRunSnapshot(
      {
        BROWSER: {} as never,
        LANDING_PAGE_ARTIFACTS: { put } as never,
      } as never,
      "https://example.com/offer",
      { requireScreenshot: true },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.metadata?.screenshotArtifactKey).toEqual(
      expect.stringMatching(/\.jpeg$/u),
    );
    expect(put).toHaveBeenCalled();
  });

  it("retries a failed screenshot once and keeps the second capture", async () => {
    const page = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    page.screenshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("screenshot failed"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const put = vi.fn().mockResolvedValue(undefined);
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));

    const { captureBrowserRunSnapshot } = await import("~/lib/browser-run.server");
    const snapshot = await captureBrowserRunSnapshot(
      {
        BROWSER: {} as never,
        LANDING_PAGE_ARTIFACTS: { put } as never,
      } as never,
      "https://example.com/offer",
      { requireScreenshot: true },
    );

    expect(page.screenshot).toHaveBeenCalledTimes(2);
    expect(snapshot?.metadata?.screenshotArtifactKey).toEqual(
      expect.stringMatching(/\.jpeg$/u),
    );
  });
});
