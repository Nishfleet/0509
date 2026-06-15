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
});
