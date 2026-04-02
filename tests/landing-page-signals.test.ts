import { afterEach, describe, expect, it, vi } from "vitest";

import { extractLandingPageSignals, LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
});
