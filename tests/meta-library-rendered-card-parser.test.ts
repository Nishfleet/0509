import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "~/lib/decode-html.server";
import {
  extractExternalLink,
  hasNoResultsSignal,
  inferLandingPageFromTextBlock,
  parseRenderedMetaLibraryHtml,
  stripHtml,
  stripHtmlPreservingLines,
} from "~/lib/meta-library-rendered-card-parser.server";

describe("meta-library-rendered-card-parser decode wiring", () => {
  it("uses the shared single-pass decoder", () => {
    // The parser used to ship its own decodeHtmlEntity with a `&gt; -> " "` quirk
    // and a chained replace loop (CodeQL js/double-escaping). It now uses the
    // single shared decoder imported from ~/lib/decode-html.server.
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeHtmlEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("stripHtml decodes entities exactly once", () => {
    expect(stripHtml("&lt;b&gt;hi&lt;/b&gt;")).toBe("<b>hi</b>");
    // Double-encoded: the outer &amp; decodes to &, the inner &lt; stays literal.
    expect(stripHtml("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("stripHtmlPreservingLines decodes entities once per line", () => {
    expect(stripHtmlPreservingLines("<p>&lt;a&gt;</p><p>&amp;b</p>")).toBe("<a>\n&b");
  });

  it("extractExternalLink decodes the href once", () => {
    const link = extractExternalLink('<a href="https://example.com/?x=1&amp;y=2">link</a>');
    expect(link).toBe("https://example.com/?x=1&y=2");
  });

  it("parseRenderedMetaLibraryHtml decodes ad anchor hrefs once", () => {
    const result = parseRenderedMetaLibraryHtml(
      '<article><a href="/ads/library/?id=1111111111&amp;ref=1">details</a></article>',
    );
    expect(result.cards[0]?.libraryId).toBe("1111111111");
  });

  it("hasNoResultsSignal is still importable (no regression)", () => {
    expect(hasNoResultsSignal("no ads found")).toBe(true);
  });
});

// Regression for issue #913: watchlist proof captures were zero in production.
// The Meta Ad Library wraps every outbound ad destination as
// l.facebook.com/l.php?u=<encoded-target>. The server-side fallback extraction
// paths (parseRenderedMetaLibraryHtml and extractQuickActionPayloadFromScrape)
// both flow through extractExternalLink, which used to reject ANY href
// containing "facebook.com" — including the wrapped redirect — so landingPageUrl
// came back null. The proof-capture candidate loop in monitoring.server.ts
// (`evaluateSelectiveProofCandidates`) skips every observation whose
// landing_page_url is null, so watchlist runs succeeded while zero proof
// captures were recorded (signals.proof.recentSuccessfulCaptures === 0).
// These tests pin the unwrap so a card whose only external link is the wrapped
// redirect still yields a non-null landingPageUrl — the necessary precondition
// for a successful proof capture to be counted.
describe("extractExternalLink unwraps l.facebook.com ad-destination redirects (#913)", () => {
  it("unwraps l.facebook.com/l.php?u= to the real landing page", () => {
    const html = `<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fpage&h=AT3xyz">Shop now</a>`;
    expect(extractExternalLink(html)).toBe("https://example.com/page");
  });

  it("unwraps lm.facebook.com/l.php?u= to the real landing page", () => {
    const html = `<a href="https://lm.facebook.com/l.php?u=https%3A%2F%2Fnykaa.com%2Fproducts%2Fglow&h=AT3abc">Buy</a>`;
    expect(extractExternalLink(html)).toBe("https://nykaa.com/products/glow");
  });

  it("skips l.facebook.com redirects that point back to facebook/instagram", () => {
    const html = `<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fpage&h=xyz">Visit</a>`;
    expect(extractExternalLink(html)).toBeNull();
  });

  it("skips l.facebook.com redirects without a u parameter", () => {
    const html = `<a href="https://l.facebook.com/l.php?h=AT3xyz">Visit</a>`;
    expect(extractExternalLink(html)).toBeNull();
  });

  it("falls back to a direct non-facebook href when the redirect is undecodable", () => {
    const html = `
      <a href="https://l.facebook.com/l.php?u=not-a-url&h=xyz">Visit</a>
      <a href="https://real-shop.com/page">Shop</a>
    `;
    expect(extractExternalLink(html)).toBe("https://real-shop.com/page");
  });

  it("returns a direct non-facebook href unchanged", () => {
    const html = `<a href="https://example.com/landing">Shop now</a>`;
    expect(extractExternalLink(html)).toBe("https://example.com/landing");
  });

  it("returns null when only facebook.com internal links are present", () => {
    const html = `<a href="https://www.facebook.com/ads/library/?id=123">Ad details</a>`;
    expect(extractExternalLink(html)).toBeNull();
  });

  it("returns null when no href is present", () => {
    const html = `<div>No links here</div>`;
    expect(extractExternalLink(html)).toBeNull();
  });
});

// End-to-end pin at the rendered-HTML fallback path: a realistic Ad Library
// card whose only outbound link is the wrapped redirect must produce a
// non-null landingPageUrl. Without the unwrap, landingPageUrl is null and the
// proof-capture candidate loop skips the observation — the exact production
// failure mode (37 monitoring runs, 0 proof captures).
describe("parseRenderedMetaLibraryHtml recovers landingPageUrl from wrapped redirects (#913)", () => {
  function adLibraryCardHtml(opts: { libraryId: string; landingHref: string }) {
    return `
      <div>
        <a href="/ads/library/?id=${opts.libraryId}">Ad details</a>
        <a href="${opts.landingHref}">Shop now</a>
      </div>
    `;
  }

  it("yields a non-null landingPageUrl for an l.facebook.com-wrapped destination", () => {
    const html = adLibraryCardHtml({
      libraryId: "999111222",
      landingHref:
        "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.allbirds.com%2Fsale&h=AT3xyz",
    });
    const result = parseRenderedMetaLibraryHtml(html);
    const card = result.cards[0];
    expect(card).toBeDefined();
    expect(card?.landingPageUrl).toBe("https://www.allbirds.com/sale");
  });

  it("yields a non-null landingPageUrl for an lm.facebook.com-wrapped destination", () => {
    const html = adLibraryCardHtml({
      libraryId: "999111223",
      landingHref:
        "https://lm.facebook.com/l.php?u=https%3A%2F%2Fnykaa.com%2Fproducts%2Fglow&h=AT3abc",
    });
    const result = parseRenderedMetaLibraryHtml(html);
    const card = result.cards[0];
    expect(card).toBeDefined();
    expect(card?.landingPageUrl).toBe("https://nykaa.com/products/glow");
  });

  it("still yields a non-null landingPageUrl for a direct (unwrapped) destination", () => {
    const html = adLibraryCardHtml({
      libraryId: "999111224",
      landingHref: "https://example.com/landing",
    });
    const result = parseRenderedMetaLibraryHtml(html);
    const card = result.cards[0];
    expect(card).toBeDefined();
    expect(card?.landingPageUrl).toBe("https://example.com/landing");
  });
});

describe("inferLandingPageFromTextBlock", () => {
  it("returns null for an empty block", () => {
    expect(inferLandingPageFromTextBlock([])).toBeNull();
  });

  it("recovers a bare-domain evidence line", () => {
    expect(inferLandingPageFromTextBlock(["Sponsored", "example.com/landing"])).toBe(
      "https://example.com/landing",
    );
  });
});

// Regression for issue #927 (PR #930): naive regex script/style stripping
// misses malformed closers (e.g. `</script >`, attribute-bearing closers,
// nested smuggling). stripHtml and stripHtmlPreservingLines now route through
// sanitize-text.server's stripScriptAndStyle which uses a parse loop tolerant
// of malformed markup. These tests pin that contract.
describe("meta-library rendered card parser stripHtml helpers", () => {
  it("stripHtml drops malformed script markup before tag stripping", () => {
    expect(stripHtml("<p>headline</p><script>alert(1)</script foo>")).toBe("headline");
  });

  it("stripHtmlPreservingLines drops malformed script markup", () => {
    expect(stripHtmlPreservingLines("<div>line one</div><script>alert(1)</script >")).toBe(
      "line one",
    );
  });
});