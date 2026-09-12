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
    // Issue #3105: the mobile leg owns this page; the desktop evidence leg
    // gets its own healthy page so the mobile retry assertions stay exact.
    const desktopPage = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const put = vi.fn().mockResolvedValue(undefined);
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi
        .fn()
        .mockResolvedValueOnce(page)
        .mockResolvedValue(desktopPage),
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

  it("retries a transient R2 put failure once and keeps the screenshot artifact", async () => {
    const page = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    // The first R2 put fails transiently; the retry succeeds. The screenshot
    // must still be persisted (issue #1856: a transient R2 failure must not
    // silently drop the primary evidence artifact).
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient r2 failure"))
      .mockResolvedValueOnce(undefined);
    // Issue #3105: a dedicated healthy desktop page renders the second
    // viewport leg after the mobile leg's puts count in the expectations.
    const desktopPage = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi
        .fn()
        .mockResolvedValueOnce(page)
        .mockResolvedValue(desktopPage),
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
    // The screenshot put was retried once (2 attempts) plus the HTML put (1):
    // 3 mobile-leg puts, plus the desktop leg's own screenshot + HTML puts
    // (issue #3105 dual viewport): 5 total. Without the retry it would be 4.
    expect(put).toHaveBeenCalledTimes(5);
  });

  it("fails the capture when the R2 put fails on both attempts and requireScreenshot is true", async () => {
    const page = createPage(
      `<html><head><title>Readable render</title></head><body><main>rendered offer body copy with enough text to count as meaningful body content for the landing page signal extractor gate</main></body></html>`,
      "https://example.com/offer",
    );
    const put = vi.fn().mockRejectedValue(new Error("r2 unavailable"));
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

    // With requireScreenshot, a capture that cannot persist the screenshot is
    // not considered successful — it must not be marked `succeeded` without an
    // artifact.
    expect(snapshot).toBeNull();
    expect(put).toHaveBeenCalledTimes(2);
  });
});

describe("installPublicBrowserRequestGuard", () => {
  function createInterceptedPage() {
    const requestHandlers: Array<(request: unknown) => void> = [];
    const page = {
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: (request: unknown) => void) => {
        if (event === "request") {
          requestHandlers.push(handler);
        }
        return page;
      }),
    };
    return { page, requestHandlers };
  }

  async function collectUnhandledRejections(emit: () => void) {
    const rejections: unknown[] = [];
    const listener = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", listener);
    try {
      emit();
      // The guarded handler is fire-and-forget; give the event loop a turn so
      // a genuinely unhandled rejection would have fired by now.
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off("unhandledRejection", listener);
    }
    return rejections;
  }

  it("swallows a continue() rejection when the target closes mid-guard", async () => {
    const { page, requestHandlers } = createInterceptedPage();
    const { installPublicBrowserRequestGuard } = await import(
      "~/lib/browser-run.server"
    );
    await installPublicBrowserRequestGuard(page as never);
    expect(requestHandlers).toHaveLength(1);

    const request = {
      url: () => "https://example.com/allowed",
      isInterceptResolutionHandled: () => false,
      continue: vi.fn().mockRejectedValue(new Error("Target closed")),
      abort: vi.fn().mockResolvedValue(undefined),
    };

    const rejections = await collectUnhandledRejections(() =>
      requestHandlers[0](request),
    );

    expect(request.continue).toHaveBeenCalledTimes(1);
    expect(rejections).toEqual([]);
  });

  it("swallows an abort() rejection when the request was already handled", async () => {
    const { resolvePublicHttpUrl } = await import("~/lib/public-url.server");
    vi.mocked(resolvePublicHttpUrl).mockResolvedValueOnce(null);

    const { page, requestHandlers } = createInterceptedPage();
    const { installPublicBrowserRequestGuard } = await import(
      "~/lib/browser-run.server"
    );
    await installPublicBrowserRequestGuard(page as never);
    expect(requestHandlers).toHaveLength(1);

    const request = {
      url: () => "https://example.com/blocked",
      isInterceptResolutionHandled: () => false,
      continue: vi.fn().mockResolvedValue(undefined),
      abort: vi
        .fn()
        .mockRejectedValue(new Error("Request is already handled")),
    };

    const rejections = await collectUnhandledRejections(() =>
      requestHandlers[0](request),
    );

    expect(request.abort).toHaveBeenCalledTimes(1);
    expect(request.continue).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });
});
