import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function mockFetchWithDns(handler: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const hostname = parsed.searchParams.get("name") ?? "";
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["93.184.216.34"] : [];
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({ data: address, type: type === "A" ? 1 : 28 })),
        }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }
    return handler(input, init);
  });
}

describe("captureLandingPageSnapshot decode wiring", () => {
  it("decodes the og:title headline entities once on the static fetch path", async () => {
    // Body has meaningful text so the rendered fallback does not fire.
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><head>
              <meta property="og:title" content="Tom &amp; Jerry &lt;3"/>
            </head><body><main>Real offer copy with enough text to count as meaningful body content for the landing page signal extractor.</main></body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    // Guard: if the static path somehow falls back to render, fail loudly
    // rather than silently asserting on the wrong capture method.
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawHeadline: "RENDERED-SHOULD-NOT-WIN",
      normalizedHeadline: "rendered-should-not-win",
      normalizedHeadlineHash: "x",
      captureMethod: "browser_render",
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      ctaText: null,
      priceText: null,
      formPresent: false,
      capturedAt: "2026-08-24T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    // Single decode pass: &amp; -> &, &lt; -> <.
    expect(snapshot?.rawHeadline).toBe("Tom & Jerry <3");
  });

  it("does not double-decode an already-decoded ampersand in the headline", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><head>
              <meta property="og:title" content="a & b already decoded"/>
            </head><body><main>Real offer copy with enough text to count as meaningful body content for the landing page signal extractor.</main></body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawHeadline: "RENDERED-SHOULD-NOT-WIN",
      normalizedHeadline: "rendered-should-not-win",
      normalizedHeadlineHash: "x",
      captureMethod: "browser_render",
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      ctaText: null,
      priceText: null,
      formPresent: false,
      capturedAt: "2026-08-24T00:00:00.000Z",
      artifactKey: null,
      metadata: {},
    });
    vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    expect(snapshot?.rawHeadline).toBe("a & b already decoded");
  });
});
