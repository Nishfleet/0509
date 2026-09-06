import { describe, expect, it } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";

// Issue #1409: the CTA extractor left HTML entities undecoded in fallback
// text. A backfill over the 2026-08-21..28 HTML set produced reached rows
// whose ctaText was the literal string `Get Started – It&#x27;s Free` — the
// hex-encoded apostrophe (&#x27;) survived into extracted_fields_json.ctaText
// because the decoder only knew a fixed set of named/decimal entities and the
// single hex entity &#x2026;. A later real edit to the same button that
// decodes cleanly would then look like a CTA change (or the reverse).
//
// These tests pin the fix: the extractor must decode &#x27;, &amp; and &quot;
// in BOTH the button fallback path and the anchor fallback path, and no
// `&#x` / `&amp;` sequence may survive into ctaText.
describe("CTA entity decoding (issue #1409)", () => {
  it("decodes &#x27;, &amp; and &quot; in the button fallback path", () => {
    const html =
      '<button>Build my report &#x27; It&#x27;s free &amp; easy &quot;now&quot;</button>';
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Build my report ' It's free & easy \"now\"");
    expect(ctaText).not.toMatch(/&#x/);
    expect(ctaText).not.toMatch(/&amp;/);
  });

  it("decodes &#x27;, &amp; and &quot; in the anchor fallback path", () => {
    const html =
      '<a href="/guide">Read the guide &#x27; It&#x27;s free &amp; easy &quot;now&quot;</a>';
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Read the guide ' It's free & easy \"now\"");
    expect(ctaText).not.toMatch(/&#x/);
    expect(ctaText).not.toMatch(/&amp;/);
  });

  it("decodes a hex-encoded apostrophe in a priority-verb CTA (acceptance example)", () => {
    const html = "<button>Get Started – It&#x27;s Free</button>";
    const { ctaText } = extractLandingPageSignals(html);
    expect(ctaText).toBe("Get Started – It's Free");
    expect(ctaText).not.toMatch(/&#x/);
  });
});
