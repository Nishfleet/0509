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

function stubRenderedToNull() {
  // The rendered fallback is disabled in these tests by having it return null,
  // so the gate's reject path is exercised end-to-end through the plain-http
  // leg alone. A separate test exercises the rendered-fallback success path.
  const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue(null);
  vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));
  return captureRenderedLandingPageSnapshot;
}

describe("captureLandingPageSnapshot capture-validity gate (BET 4)", () => {
  it("records capture_failed for a Cloudflare challenge page and produces no snapshot", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><head><title>Just a moment...</title></head>
            <body><div id="cf-challenge-running">Verifying you are human.</div>
            <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"></script></body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    const renderedStub = stubRenderedToNull();

    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/offer",
      { onFailure, allowRenderedFallback: true },
    );

    // No snapshot: the gate rejected, the rendered fallback also returned null.
    expect(snapshot).toBeNull();
    // The failure hook fired with the gate's challenge reason code — this is
    // the `capture_failed` state the monitoring pipeline records, and it is
    // never an alert.
    expect(onFailure).toHaveBeenCalledTimes(1);
    const detail = onFailure.mock.calls[0][0];
    expect(detail.reasonCode).toBe("landing_challenge_page");
    expect(detail.metadata.captureValidityReason).toContain("challenge");
    // The rendered fallback was attempted (the challenge may render past the
    // gate client-side) before the final reject.
    expect(renderedStub).toHaveBeenCalledTimes(1);
  });

  it("records capture_failed for a cookie wall and produces no snapshot", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><body>
              <div id="onetrust-banner-sdk">
                <p>Please accept cookies to continue.</p>
                <button id="onetrust-accept-all-handler">Accept all cookies</button>
              </div>
            </body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    stubRenderedToNull();

    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/offer",
      { onFailure, allowRenderedFallback: true },
    );

    expect(snapshot).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].reasonCode).toBe("landing_cookie_wall");
  });

  it("records capture_failed for a partial SPA shell and produces no snapshot", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><body><div id="root"></div></body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    stubRenderedToNull();

    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/offer",
      { onFailure, allowRenderedFallback: true },
    );

    expect(snapshot).toBeNull();
    expect(onFailure.mock.calls[0][0].reasonCode).toBe("landing_partial_spa");
  });

  it("still produces a snapshot for a real landing page (gate does not over-reject)", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><head><title>Glow Serum — Save 20% Today</title></head>
            <body><main>
              <h1>Glow Serum — Save 20% Today</h1>
              <p>Our best-selling vitamin C serum, now at 20% off for the launch week.</p>
              <p>Starting at ₹499. Free shipping on orders over ₹999.</p>
              <a href="/buy" class="cta">Buy now</a>
            </main>
            <footer>© 2026 Glow Co. All rights reserved. Terms · Privacy · Support</footer>
            </body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));

    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/offer",
      { onFailure },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    // The gate ran and passed: the snapshot carries captureValidated.
    expect(snapshot?.metadata?.captureValidated).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    // The rendered fallback is not attempted when the plain-http leg passes
    // the gate (no empty-shell trigger).
    expect(captureRenderedLandingPageSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to render when the plain-http leg hits a challenge and render passes the gate", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(
            `<html><head><title>Just a moment...</title></head>
            <body><div id="cf-challenge-running">Verifying you are human.</div></body></html>`,
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ) as never,
    );
    // The rendered leg returns a real, gate-passing snapshot — the challenge
    // rendered client-side past the gate.
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawHeadline: "Glow Serum Sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-rendered",
      captureMethod: "browser_render",
      rawUrl: "https://example.com/offer",
      canonicalUrl: "https://example.com/offer",
      ctaText: "Buy now",
      priceText: "Starting at ₹499",
      formPresent: true,
      capturedAt: "2026-08-25T00:00:00.000Z",
      artifactKey: null,
      metadata: { captureValidated: true, screenshotCorroborates: true },
    });
    vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));

    const onFailure = vi.fn();
    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/offer",
      { onFailure, allowRenderedFallback: true },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("browser_render");
    expect(onFailure).not.toHaveBeenCalled();
    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledTimes(1);
  });
});
