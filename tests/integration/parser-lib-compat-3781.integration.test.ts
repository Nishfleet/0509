import { describe, expect, it } from "vitest";

import { XMLParser } from "fast-xml-parser";
import Papa from "papaparse";
import he from "he";
import RobotsParser from "robots-parser";
import RssParser from "rss-parser";

/**
 * Issue 3781 compat gate — each candidate parser library must actually RUN
 * under real workerd (Miniflare, `workers` vitest project) before the swap
 * PR can rely on it. One test per package; every assertion exercises the
 * library's primary entry point rather than just importing it.
 *
 * NOT verified here: sanitize-html. Its import chain (postcss) cannot load
 * under workerd — `TypeError: Cannot destructure property 'nanoid' of
 * 'require(...)' as it is undefined` from postcss/lib/input.js via the
 * mf_vitest_no_cjs_esm_shim. Compat FAIL for bullet 2, recorded on the
 * issue; the swap is skipped for that reason (and additionally on fixture
 * byte-parity grounds).
 */
describe("parser library workerd compatibility (issue 3781)", () => {
  it("he decodes numeric + named entities on workerd", () => {
    expect(he.decode("a &amp; b &#65;")).toBe("a & b A");
  });

  it("robots-parser evaluates disallow rules on workerd", () => {
    const parser = new RobotsParser("https://example.com", "User-agent: *\nDisallow: /private\n");
    expect(parser.isAllowed("https://example.com/private/x")).toBe(false);
    expect(parser.isAllowed("https://example.com/open")).toBe(true);
  });

  it("rss-parser parses an RSS feed on workerd", async () => {
    const parser = new RssParser();
    const feed = await parser.parseString(
      `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Hi</title><link>https://1.1.1.1/a</link></item></channel></rss>`,
    );
    expect(feed.items?.[0]?.title).toBe("Hi");
  });

  it("fast-xml-parser parses XML preserving order on workerd", () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      preserveOrder: true,
      trimValues: false,
      processEntities: false,
    });
    const doc = parser.parse(`<rss><channel><item><title>x</title></item></channel></rss>`);
    expect(doc[0].rss[0].channel).toBeDefined();
  });

  it("papaparse parses CSV rows on workerd", () => {
    const parsed = Papa.parse("name,domain\na,b", { header: false, delimiter: "," });
    expect(parsed.data[0][0]).toBe("name");
    expect(parsed.data[1][1]).toBe("b");
  });
});
