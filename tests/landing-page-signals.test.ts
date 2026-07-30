import { afterEach, describe, expect, it, vi } from "vitest";

import { extractLandingPageSignals, LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchWithDns(handler: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["93.184.216.34"] : [];
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

describe("extractLandingPageSignals", () => {
  it("extracts CTA text from a primary button", () => {
    const html = `
      <html>
        <body>
          <button>Buy Now</button>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy Now",
      priceText: null,
      formPresent: false,
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    });
  });

  it("extracts offer-style price text from india commerce copy", () => {
    const html = `
      <html>
        <body>
          <p>Starting at ₹499 only today</p>
          <a href="/shop">Shop now</a>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: false,
    });
  });

  it("detects forms from real form markup and submit inputs", () => {
    const html = `
      <html>
        <body>
          <form action="/lead">
            <input name="name" />
            <input name="phone" />
            <input type="submit" value="Get Offer" />
          </form>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get Offer",
      formPresent: true,
    });
  });

  it("extracts submit CTA values regardless of HTML attribute order", () => {
    const html = `
      <form>
        <input value="Get Offer" class="primary" type="submit" />
      </form>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get Offer",
      formPresent: true,
    });
  });

  it("extracts unquoted submit attributes", () => {
    const html = `
      <form>
        <input value=Submit type=submit />
      </form>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Submit",
      formPresent: true,
    });
  });

  it("keeps the opposite quote inside a quoted submit value", () => {
    const html = `
      <form>
        <input type='submit' value="Buy now — customer's choice" />
      </form>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now — customer's choice",
      formPresent: true,
    });
  });

  it("extracts decimal prices in non-INR currencies", () => {
    const html = `
      <main>
        <p>Launch price $49.99 for this week</p>
        <a href="/checkout">Buy now</a>
      </main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: "$49.99",
    });
  });

  it("ignores non-visible script data before matching the displayed price", () => {
    const html = `
      <script>window.cfg = { price: "$9.99" };</script>
      <style>.price::before { content: "$19.99"; }</style>
      <main>
        <p>Launch price $49.99 for this week</p>
      </main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      priceText: "$49.99",
    });
  });

  it("ignores commented-out CTA, price, and form markup", () => {
    const html = `
      <main>
        <!--
          <a href="/checkout">Buy now</a>
          <p>Old price $9.99</p>
          <form action="/lead"><input type="submit" value="Get offer"></form>
        -->
        <p>Current product details.</p>
      </main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
  });

  it("keeps noscript fallback signals for raw fetch captures", () => {
    const html = `
      <noscript>
        <a href="/checkout">Shop now</a>
        <p>Fallback price $39.99</p>
        <form action="/lead"><input name="email"></form>
      </noscript>
    `;

    expect(extractLandingPageSignals(html, { documentMode: "raw" })).toMatchObject({
      ctaText: "Shop now",
      priceText: "$39.99",
      formPresent: true,
    });
  });

  it("ignores noscript fallback signals in rendered captures", () => {
    const html = `
      <noscript>
        <a href="/checkout">Shop now</a>
        <p>Fallback price $39.99</p>
      </noscript>
      <main>
        <button>Book demo</button>
        <p>Team plan $79.99</p>
      </main>
    `;

    expect(extractLandingPageSignals(html, { documentMode: "rendered" })).toMatchObject({
      ctaText: "Book demo",
      priceText: "$79.99",
    });
  });

  it("reads submit inputs whose quoted attributes contain greater-than signs", () => {
    const html = `
      <input data-rule="quantity > 1" value="Get started" type="submit">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
    });
  });

  it("treats the remainder of malformed unclosed script content as non-visible", () => {
    const html = `
      <script>
        window.cfg = { price: "$9.99" };
        ${"<script>".repeat(2_000)}
        <main>Displayed-looking but still script content $49.99</main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
  });

  it("bounds malformed quoted-tag scanning", () => {
    const html = `<input title="${"<".repeat(50_000)}`;
    const startedAt = performance.now();

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
    expect(performance.now() - startedAt).toBeLessThan(750);
  }, 3_000);

  it("removes hidden elements whose opening tag exceeds the normal scan bound", () => {
    const html = `
      <script data-payload="${"x".repeat(5_000)}">
        window.offer = "$9.99";
      </script>
      <main>Visible price $49.99</main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      priceText: "$49.99",
      ctaText: null,
      formPresent: false,
    });
  });

  it("detects unquoted submit controls with quote-complicated attributes", () => {
    const html = `
      <input name="email" placeholder="Work email">
      <input data-rule="quantity > 1" type=submit value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("returns null CTA and price when nothing high-signal is detected", () => {
    const html = `
      <html>
        <body>
          <p>Learn more about our brand story.</p>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
  });
});

describe("captureLandingPageSnapshot", () => {
  it("includes extracted landing-page signals for fetch captures", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          `
            <html>
              <head>
                <title>Glow Serum Sale</title>
              </head>
              <body>
                <button>Shop now</button>
                <p>Starting at ₹499 only today</p>
              </body>
            </html>
          `,
          { status: 200 },
        ),
      ) as never,
    );

    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/glow");

    expect(snapshot).toMatchObject({
      rawHeadline: "Glow Serum Sale",
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: false,
      captureMethod: "landing_page_fetch",
    });
  });

  it("refuses oversized landing-page HTML before storing artifacts", async () => {
    const put = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response("<html></html>", {
          status: 200,
          headers: {
            "content-length": "1000001",
          },
        }),
      ) as never,
    );

    const snapshot = await captureLandingPageSnapshot(
      { LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket },
      "https://example.com/glow",
      { allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps a readable fetch capture when optional R2 persistence fails", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Readable offer</title></head><body><button>Buy now</button></body></html>",
          { status: 200 },
        ),
      ) as never,
    );
    const put = vi.fn().mockRejectedValue(new Error("R2 unavailable"));

    const snapshot = await captureLandingPageSnapshot(
      { LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket },
      "https://example.com/offer",
    );

    expect(snapshot).toMatchObject({
      rawHeadline: "Readable offer",
      artifactKey: null,
      metadata: {
        captureWarningCodes: ["artifact_persistence_failed"],
      },
    });
  });

  it("releases fetch timeout timers on redirect responses without a usable location", async () => {
    vi.useFakeTimers();
    mockFetchWithDns(
      vi.fn(async () => new Response(null, { status: 302 })) as never,
    );

    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases fetch timeout timers on non-OK fetch responses without rendered fallback", async () => {
    vi.useFakeTimers();
    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 500 })) as never,
    );

    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a stable reason code when a blocked landing page cannot be captured", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("forbidden", { status: 403 })) as never,
    );
    const onFailure = vi.fn();

    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { allowRenderedFallback: false, onFailure },
    );

    expect(snapshot).toBeNull();
    expect(onFailure).toHaveBeenCalledWith({
      reasonCode: "landing_blocked",
      metadata: { fetchStatus: 403 },
    });
  });
});
