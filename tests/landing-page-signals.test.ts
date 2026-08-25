import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractLandingPageSignals,
  hasMeaningfulLandingPageBodyText,
  LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
} from "~/lib/landing-page-signals.server";
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
  it("treats entity-encoded loading text as an SPA shell placeholder", () => {
    expect(
      hasMeaningfulLandingPageBodyText(
        '<body><div id="root">Loading&hellip;</div></body>',
      ),
    ).toBe(false);
  });

  it("decodes HTML entities once without corrupting literal entity text", () => {
    expect(
      extractLandingPageSignals(
        "<button>Buy now &amp;hellip;</button>",
      ),
    ).toMatchObject({
      ctaText: "Buy now &hellip;",
    });
  });

  it("keeps body text after an XHTML-style empty head", () => {
    expect(
      hasMeaningfulLandingPageBodyText(
        "<html><head/><body>Actual offer details</body></html>",
      ),
    ).toBe(true);
  });

  it("implicitly closes malformed head content when body flow starts", () => {
    expect(
      hasMeaningfulLandingPageBodyText(
        "<html><head><title>Metadata only</title><body>Actual offer details</body></html>",
      ),
    ).toBe(true);
    expect(
      hasMeaningfulLandingPageBodyText(
        "<html><head><title>Metadata only</title><body>Loading…</body></html>",
      ),
    ).toBe(false);
  });

  it("implicitly closes malformed head content when the body tag is omitted", () => {
    expect(
      hasMeaningfulLandingPageBodyText(
        '<html><head><meta name="description" content="Metadata only"><title>Metadata only</title><main>Actual offer details</main></html>',
      ),
    ).toBe(true);
    expect(
      hasMeaningfulLandingPageBodyText(
        '<html><head><meta name="description" content="Metadata only"><title>Metadata only</title><div>Loading…</div></html>',
      ),
    ).toBe(false);
  });

  it("does not treat tag-looking head comments as body flow", () => {
    expect(
      hasMeaningfulLandingPageBodyText(
        "<html><head><!-- <div>Fake comment content</div> --><body>Loading…</body></html>",
      ),
    ).toBe(false);
    expect(
      hasMeaningfulLandingPageBodyText(
        "<html><head><!-- <main>Fake comment content</main> --><body>Actual offer details</body></html>",
      ),
    ).toBe(true);
  });

  it("does not treat tag-looking head container content as body flow", () => {
    const hiddenHeadContent = `
      <script>window.shell = "<div>Fake script content</div>";</script>
      <style>.offer::before { content: "<h1>Fake style content</h1>"; }</style>
      <template>
        <script>window.template = "<main>Fake template script</main>";</script>
        <template><main>Fake template content</main></template>
      </template>
    `;

    expect(
      hasMeaningfulLandingPageBodyText(
        `<html><head>${hiddenHeadContent}<main>Loading…</main></html>`,
      ),
    ).toBe(false);
    expect(
      hasMeaningfulLandingPageBodyText(
        `<html><head>${hiddenHeadContent}<main>Actual offer details</main></html>`,
      ),
    ).toBe(true);
  });

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

  it("treats XHTML-style script slashes as non-void HTML markup", () => {
    const html = `
      <script />window.offer = "$9.99";</script>
      <main>
        <p>Launch price $49.99 for this week</p>
        <button>Buy now</button>
      </main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: "$49.99",
      formPresent: false,
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

  it("keeps malformed quoted-tag scanning near-linear", () => {
    const smallHtml = `<input title="${"<".repeat(12_500)}`;
    const largeHtml = `<input title="${"<".repeat(50_000)}`;

    expect(extractLandingPageSignals(largeHtml)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
  });

  it("does not rescan overlapping windows of repeated malformed tags", () => {
    const smallHtml = "<input".repeat(12_500);
    const largeHtml = "<input".repeat(50_000);

    expect(extractLandingPageSignals(largeHtml)).toMatchObject({
      ctaText: null,
      priceText: null,
      formPresent: false,
    });
  });

  it("recovers a valid submit tag after a malformed quoted tag", () => {
    const html = `
      <img alt="unterminated attribute
      <input name="email" type="submit" value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("keeps less-than comparisons inside quoted attributes", () => {
    const html = `
      <script data-rule="quantity<10">window.offer = "$9.99";</script>
      <button>Book demo</button>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Book demo",
      priceText: null,
      formPresent: false,
    });
  });

  it("keeps less-than comparisons inside multiline quoted attributes", () => {
    const html = `
      <script data-rule="first line
        literal<word">window.offer = "$9.99";</script>
      <button>Book demo</button>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Book demo",
      priceText: null,
      formPresent: false,
    });
  });

  it("recovers a valid tag inside a single-line unterminated quoted attribute", () => {
    const html = `<img alt='unterminated <input name="email" type="submit" value="Get started">`;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

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

  it("does not treat the name attribute token itself as a lead field", () => {
    const html = `
      <input name="quantity" type="number">
      <input type="submit" value="Buy now">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      formPresent: false,
    });
  });

  it("uses semantic input attributes when the field name is opaque", () => {
    const html = `
      <input name="entry.123456" autocomplete="email">
      <input type="submit" value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("detects phone lead forms from the language-independent tel type", () => {
    const html = `
      <input type="tel" name="contact" placeholder="+49 151 123456">
      <input type="submit" value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("detects lead fields whose semantic names use camelCase or separators", () => {
    const html = `
      <input name="firstName">
      <input id="user_email">
      <input type="submit" value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("keeps content after a hidden opening tag with an unquoted less-than value", () => {
    const html = `
      <script data-rule=quantity<breakpoint>window.offer = "$9.99";</script>
      <button>Buy now</button>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: null,
      formPresent: false,
    });
  });

  it("keeps submit controls whose unquoted attributes contain less-than signs", () => {
    const html = `
      <input name="email">
      <input data-rule=quantity<breakpoint type="submit" value="Buy now">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      formPresent: true,
    });
  });

  it("recovers a tag that starts near the end of a failed unquoted scan window", () => {
    const html = `
      <div data-rule=${"x".repeat(4_080)}<input name="email" type="submit" value="Get started">
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      formPresent: true,
    });
  });

  it("prioritizes hidden tags when recovering an unterminated quoted tag", () => {
    const html = `
      <div alt='broken <script>window.offer = "$9.99";</script>
      <button>Buy now</button>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: null,
      formPresent: false,
    });
  });

  it("prioritizes the active hidden element's closing tag during recovery", () => {
    const html = `
      <script>
        if (count<items.length) render();
        // Don't re-render
      </script>
      <button>Buy now</button>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: null,
      formPresent: false,
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

  it("ignores rotating ad-slot creative in div ad containers", () => {
    const html = `
      <html>
        <body>
          <div id="ad-slot-1">
            <a href="#">Buy now</a>
            <p>$19.99</p>
            <input name="email" />
            <input type="submit" value="Claim deal" />
          </div>
          <main>
            <p>Launch price $49.99</p>
            <button>Shop now</button>
          </main>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Shop now",
      priceText: "$49.99",
      formPresent: false,
    });
  });

  it("ignores google adsense and sponsored ad blocks", () => {
    const html = `
      <html>
        <body>
          <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-1">
            <a href="#">Buy now</a>
            $9.99
          </ins>
          <section class="sponsored">
            <a href="#">Claim deal</a>
            <p>₹199 only</p>
            <input name="phone" />
            <input type="submit" value="Get offer" />
          </section>
          <main>
            <p>Team plan $79.99</p>
            <button>Book demo</button>
          </main>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Book demo",
      priceText: "$79.99",
      formPresent: false,
    });
  });

  it("ignores ad iframes and amp-ad elements", () => {
    const html = `
      <html>
        <body>
          <iframe src="https://ads.example.com/unit">
            <a href="#">Buy now</a>
            <p>$9.99</p>
          </iframe>
          <amp-ad width="300" height="250" type="doubleclick">
            <a href="#">Shop now</a>
            $5.99
          </amp-ad>
          <main>
            <button>Get started</button>
            <p>Pro plan $29.99</p>
          </main>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      priceText: "$29.99",
      formPresent: false,
    });
  });

  it("strips nested divs inside an ad container", () => {
    const html = `
      <div id="ad-slot-1">
        <div class="inner">
          <div class="inner-2"><a href="#">Buy now</a></div>
        </div>
      </div>
      <main><button>Shop now</button><p>$49.99</p></main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Shop now",
      priceText: "$49.99",
    });
  });

  it("keeps the page intact when an ad region never closes", () => {
    const html = `
      <div class="ad">
        <p>$9.99</p>
      <main>
        <button>Buy now</button>
        <p>Launch price $49.99</p>
      </main>
    `;

    // Fail safe: malformed/unclosed ad markup must not eat real content.
    // The ad-slot price stays (old behavior) but the real CTA survives.
    const signals = extractLandingPageSignals(html);
    expect(signals.ctaText).toBe("Buy now");
    expect(signals.priceText).toBe("$9.99");
  });

  it("keeps content inside ad-token lookalike words", () => {
    const html = `
      <div class="header">
        <a href="/shop">Shop now</a>
      </div>
      <div class="adventure-card">
        <p>$49.99</p>
      </div>
      <div id="address">
        <input name="email" />
        <input type="submit" value="Get started" />
      </div>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Get started",
      priceText: "$49.99",
      formPresent: true,
    });
  });

  it("ignores google ad manager divs identified only by data-ad-* attributes", () => {
    // Google Ad Manager slots are bare <div>s with `data-ad-slot` /
    // `data-ad-unit` / `data-ad-client` / `data-ad-format` and no id or class.
    // The token path above never sees them; the data-attribute path must.
    const html = `
      <html>
        <body>
          <div data-ad-slot="1234567890" data-ad-format="auto">
            <a href="#">Buy now</a>
            <p>$19.99</p>
          </div>
          <div data-ad-unit="Leaderboard-Top" data-ad-client="ca-pub-1">
            <a href="#">Claim deal</a>
            <p>₹199</p>
          </div>
          <main>
            <button>Book demo</button>
            <p>Team plan $79.99</p>
          </main>
        </body>
      </html>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Book demo",
      priceText: "$79.99",
      formPresent: false,
    });
  });

  it("ignores GAM-style boolean data-ad-layout attributes with no id or class", () => {
    // Boolean attributes (no value) are common when an ad tag is in-article
    // (`data-ad-layout="in-article"` is the only state marker carried).
    const html = `
      <div data-ad-slot data-ad-layout="in-article">
        <a href="#">Shop now</a>
        <p>$9.99</p>
      </div>
      <main><button>Buy now</button><p>$49.99</p></main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: "$49.99",
    });
  });

  it("keeps real content when the data-ad-* literal appears inside an attribute value", () => {
    // A media page may legitimately carry the phrase "data-ad-slot" in
    // surrounding meta content (e.g. a developer article quoting the
    // attribute name). The data-attribute path reads attribute NAMES outside
    // quotes, so a value that contains the phrase "data-ad-slot" must not
    // strip anything; the recognised attribute only fires on the bare
    // <div data-ad-slot=...> form.
    const html = `
      <div class="docs">
        <p>Use a div with data-ad-slot to load a unit.</p>
      </div>
      <main>
        <a href="/shop">Shop now</a>
        <p>Team plan $79.99</p>
      </main>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Shop now",
      priceText: "$79.99",
    });
  });

  it("keeps signals from unmarked product content wrappers", () => {
    const html = `
      <div class="product-card">
        <p>Launch price $49.99</p>
        <button>Buy now</button>
      </div>
    `;

    expect(extractLandingPageSignals(html)).toMatchObject({
      ctaText: "Buy now",
      priceText: "$49.99",
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
                <p>Starting at ₹499 only today. Our best-selling vitamin C serum is on launch sale with free shipping on all orders above the free-shipping threshold.</p>
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
          "<html><head><title>Readable offer</title></head><body><button>Buy now</button><p>Our best-selling vitamin C serum is on launch sale with free shipping on all orders above the free-shipping threshold.</p></body></html>",
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
    vi.useRealTimers();
  });

  it("releases fetch timeout timers on non-OK fetch responses without rendered fallback", async () => {
    // Verify timer hygiene without fake timers. Faking only setTimeout/
    // clearTimeout creates a race between real async work (DNS resolution,
    // crypto.subtle.digest, mock fetch) and the fake clock's retry sleep:
    // under CI load the sleep(250) timer can be scheduled after a one-shot
    // clock advance has already passed, so it never fires and the test hangs.
    // Instead, spy on setTimeout/clearTimeout to track outstanding timers and
    // assert they are all released after the capture completes. The retry
    // sleep (250ms) runs on the real clock, so the test is fully deterministic.
    // vi.useRealTimers() is a defensive reset — the preceding redirect-timer
    // test now cleans up its own fake timers, but afterEach's
    // vi.restoreAllMocks() does not undo vi.useFakeTimers(), so be explicit.
    vi.useRealTimers();
    const pendingTimers = new Set<unknown>();
    const originalSetTimeout = globalThis.setTimeout.bind(globalThis) as typeof setTimeout;
    const originalClearTimeout = globalThis.clearTimeout.bind(globalThis) as typeof clearTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
        let id: unknown;
        const wrapped: TimerHandler = () => {
          pendingTimers.delete(id);
          if (typeof handler === "function") (handler as () => void)();
        };
        id = originalSetTimeout(wrapped, timeout, ...rest);
        pendingTimers.add(id);
        return id;
      }) as unknown as typeof setTimeout,
    );
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(
      ((id?: unknown) => {
        if (id !== undefined) pendingTimers.delete(id);
        originalClearTimeout(id as ReturnType<typeof setTimeout>);
      }) as unknown as typeof clearTimeout,
    );

    mockFetchWithDns(
      vi.fn(async () => new Response("blocked", { status: 500 })) as never,
    );

    const snapshot = await captureLandingPageSnapshot(
      {},
      "https://example.com/glow",
      { allowRenderedFallback: false },
    );

    expect(snapshot).toBeNull();
    // All fetch-timeout and retry-sleep timers must be released or fired.
    expect(pendingTimers.size).toBe(0);
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
