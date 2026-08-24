import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "~/lib/decode-html.server";
import {
  extractExternalLink,
  hasNoResultsSignal,
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
