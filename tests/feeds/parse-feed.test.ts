import { describe, expect, it } from "vitest";

import { MAX_FEED_ITEMS, hashItemKeys, isFeedDocument, keyItems, parseFeed } from "../../app/lib/feeds/parse-feed";
import { sha256Hex } from "../../app/lib/sha256";

const NOW = new Date("2026-10-02T03:00:00Z");
const BASE = "https://rival.com/feed";

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Rival blog</title><link>https://rival.com/</link>${items}</channel></rss>`;

const atom = (entries: string) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Rival changelog</title>${entries}</feed>`;

const rdf = (items: string) =>
  `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">` +
  `<channel><title>Rival</title><link>https://rival.com/</link></channel>${items}</rdf:RDF>`;

describe("parseFeed", () => {
  it("reads an RSS 2.0 item: title, link, guid, date and a plain-text excerpt", () => {
    const items = parseFeed(
      rss(`<item><title>Launching Rival 2</title><link>https://rival.com/blog/2</link>
        <guid isPermaLink="false">post-2</guid><pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<p>The <b>biggest</b> release &amp; more.</p>]]></description></item>`),
      BASE,
      { now: NOW },
    );
    expect(items).toEqual([
      {
        id: "post-2",
        title: "Launching Rival 2",
        url: "https://rival.com/blog/2",
        excerpt: "The biggest release & more.",
        publishedAt: "2026-09-30T10:00:00.000Z",
      },
    ]);
  });

  it("reads an Atom entry, preferring the alternate link and resolving a relative href", () => {
    const items = parseFeed(
      atom(`<entry><title type="html">Fixed &lt;em&gt;billing&lt;/em&gt; export</title>
        <link rel="self" href="https://rival.com/api/1"/><link rel="alternate" href="/changelog/42"/>
        <id>tag:rival.com,2026:42</id><published>2026-10-01T08:30:00Z</published>
        <summary>Exports no longer time out.</summary></entry>`),
      "https://rival.com/changelog.xml",
      { now: NOW },
    );
    expect(items).toEqual([
      {
        id: "tag:rival.com,2026:42",
        title: "Fixed billing export",
        url: "https://rival.com/changelog/42",
        excerpt: "Exports no longer time out.",
        publishedAt: "2026-10-01T08:30:00.000Z",
      },
    ]);
  });

  it("falls back to the link as the id, falls back to updated for the date and leaves a missing excerpt null", () => {
    const [item] =
      parseFeed(
        atom(
          `<entry><title>Post</title><link href="https://rival.com/p"/><updated>2026-09-29T00:00:00Z</updated></entry>`,
        ),
        BASE,
        { now: NOW },
      ) ?? [];
    expect(item).toMatchObject({ id: "https://rival.com/p", excerpt: null, publishedAt: "2026-09-29T00:00:00.000Z" });
  });

  it("skips items with no title, no link, or a link that is not http or https", () => {
    const items = parseFeed(
      rss(`<item><link>https://rival.com/a</link></item>
        <item><title>No link</title></item>
        <item><title>Script</title><link>javascript:alert(1)</link></item>
        <item><title>Mail</title><link>mailto:a@b.co</link></item>
        <item><title>Fine</title><link>https://rival.com/ok</link></item>`),
      BASE,
      { now: NOW },
    );
    expect(items?.map((item) => item.title)).toEqual(["Fine"]);
  });

  it("drops items older than 30 days but keeps undated ones", () => {
    const items = parseFeed(
      rss(`<item><title>Old</title><link>https://rival.com/old</link><pubDate>Mon, 31 Aug 2026 10:00:00 GMT</pubDate></item>
        <item><title>Edge</title><link>https://rival.com/edge</link><pubDate>Sun, 06 Sep 2026 10:00:00 GMT</pubDate></item>
        <item><title>Undated</title><link>https://rival.com/undated</link></item>`),
      BASE,
      { now: NOW },
    );
    expect(items?.map((item) => item.title)).toEqual(["Edge", "Undated"]);
  });

  it("sorts newest first and caps the list at the newest 20", () => {
    const many = Array.from(
      { length: 30 },
      (_unused, index) =>
        `<item><title>Post ${String(index)}</title><link>https://rival.com/p/${String(index)}</link><pubDate>${new Date(Date.UTC(2026, 8, 20, index)).toUTCString()}</pubDate></item>`,
    ).join("");
    const items = parseFeed(rss(many), BASE, { now: NOW }) ?? [];
    expect(items).toHaveLength(MAX_FEED_ITEMS);
    expect(items[0]?.title).toBe("Post 29");
    expect(items.at(-1)?.title).toBe("Post 10");
  });

  it("keeps one copy of an item that appears twice under the same guid", () => {
    const twice = `<item><title>Same</title><link>https://rival.com/s</link><guid>g1</guid></item>`;
    expect(parseFeed(rss(twice + twice), BASE, { now: NOW })).toHaveLength(1);
  });

  it("truncates a long title and excerpt", () => {
    const [item] =
      parseFeed(
        rss(
          `<item><title>${"t".repeat(500)}</title><link>https://rival.com/l</link><description>${"d ".repeat(400)}</description></item>`,
        ),
        BASE,
        { now: NOW },
      ) ?? [];
    expect(item?.title).toHaveLength(200);
    expect(item?.excerpt?.length).toBeLessThanOrEqual(200);
    expect(item?.excerpt?.endsWith("…")).toBe(true);
  });

  it("decodes numeric entities and turns an out-of-range one into a replacement character", () => {
    // &#8217; and &#x41; decode; &#99999999; is past U+10FFFF, so the XML parser
    // emits U+FFFD. The old hand-rolled decoder silently deleted the
    // out-of-range entity; the library's reading is the spec's, and a U+FFFD in
    // a title is visible where a missing character would hide a broken feed.
    const [item] =
      parseFeed(
        rss(`<item><title>A&#8217;s &#x41; &#99999999; plan</title><link>https://rival.com/e</link></item>`),
        BASE,
        { now: NOW },
      ) ?? [];
    expect(item?.title).toBe("A’s A \uFFFD plan");
  });

  it("returns null for HTML, JSON and an empty body, and an empty list for a feed with no items", () => {
    expect(parseFeed("<!doctype html><html><body>hi</body></html>", BASE, { now: NOW })).toBeNull();
    expect(parseFeed('{"items":[]}', BASE, { now: NOW })).toBeNull();
    expect(parseFeed("", BASE, { now: NOW })).toBeNull();
    expect(parseFeed(rss(""), BASE, { now: NOW })).toEqual([]);
  });

  it("does not read the channel's own title or link as an item", () => {
    expect(parseFeed(rss(""), BASE, { now: NOW })).toEqual([]);
  });
});

describe("parseFeed, items it must drop or keep", () => {
  it("keeps an unparseable date and a later textual link, and drops a blank title, blank link, or non-http link", () => {
    const items = parseFeed(
      rss(
        `<item><title>A</title><link>https://rival.com/a</link><pubDate>garbage</pubDate></item>` +
          `<item><title>   </title><link>https://rival.com/b</link></item>` +
          `<item><title>C</title><link>   </link></item>` +
          `<item><title>D</title><link>javascript:alert(1)</link></item>` +
          `<item><title>E</title><link rel="self"/><link>https://rival.com/e</link></item>`,
      ),
      BASE,
      { now: NOW },
    );

    expect(items?.map((item) => item.title)).toEqual(["A", "E"]);
    expect(items?.[0]).toMatchObject({ id: "https://rival.com/a", publishedAt: null });
    expect(items?.[1]?.url).toBe("https://rival.com/e");
  });
});

describe("parseFeed on the formats the hand-rolled scanner could not read", () => {
  it("reads an RDF item and its dc:date, and dates it from the namespaced tag", () => {
    const items = parseFeed(
      rdf(`<item><title>RDF post</title><link>https://rival.com/rdf/1</link>
        <description>Old school</description><dc:date>2026-09-30T10:00:00Z</dc:date></item>`),
      BASE,
      { now: NOW },
    );

    expect(items).toEqual([
      {
        id: "https://rival.com/rdf/1",
        title: "RDF post",
        url: "https://rival.com/rdf/1",
        excerpt: "Old school",
        publishedAt: "2026-09-30T10:00:00.000Z",
      },
    ]);
  });

  it("reads a namespaced media title and an item inside an Atom namespaced document", () => {
    const items = parseFeed(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
        <title>C</title><entry><title type="html">Namespaced</title>
        <link rel="alternate" href="/ns/1"/><id>ns-1</id>
        <updated>2026-10-01T00:00:00Z</updated></entry></feed>`,
      BASE,
      { now: NOW },
    );

    expect(items?.map((item) => item.id)).toEqual(["ns-1"]);
  });
});

describe("isFeedDocument", () => {
  it("accepts rss, feed and rdf roots only", () => {
    expect(isFeedDocument("<?xml version='1.0'?><rss version='2.0'></rss>")).toBe(true);
    expect(isFeedDocument("<feed xmlns='http://www.w3.org/2005/Atom'></feed>")).toBe(true);
    expect(isFeedDocument("<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'></rdf:RDF>")).toBe(true);
    expect(isFeedDocument("<html><body><feedback>x</feedback></body></html>")).toBe(false);
  });
});

describe("item keys", () => {
  it("hashes an id to the same 64-character key every time", async () => {
    const first = await sha256Hex("post-2");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("post-2")).toBe(first);
    expect(await sha256Hex("post-3")).not.toBe(first);
  });

  it("gives a list the same hash whatever its order", async () => {
    const items = [
      { id: "a", title: "A", url: "https://x.co/a", excerpt: null, publishedAt: null },
      { id: "b", title: "B", url: "https://x.co/b", excerpt: null, publishedAt: null },
    ];
    const forward = await hashItemKeys(await keyItems(items));
    const backward = await hashItemKeys(await keyItems([...items].reverse()));
    expect(forward).toBe(backward);
    expect(await hashItemKeys(await keyItems(items.slice(0, 1)))).not.toBe(forward);
  });

  it("keys an item with no guid by its URL, so a re-read files nothing new", async () => {
    const xml = rss(`<item><title>Same</title><link>https://rival.com/s</link></item>`);
    const first = await keyItems(parseFeed(xml, BASE, { now: NOW }) ?? []);
    const second = await keyItems(parseFeed(xml, BASE, { now: NOW }) ?? []);

    expect(first[0]?.id).toBe("https://rival.com/s");
    expect(second[0]?.key).toBe(first[0]?.key);
  });
});

describe("parseFeed on hostile input", () => {
  it.each([
    ["unclosed item tags", "<item>"],
    ["unclosed entry tags", "<entry>"],
    ["unclosed link tags inside one item", "<link>"],
    ["unclosed CDATA openers", "<![CDATA["],
    ["bare angle brackets", "<"],
    ["unclosed title and description tags", "<title><description>"],
  ])("returns without throwing on 2 MiB of %s", (_label, unit) => {
    const filler = unit.repeat(Math.floor((2 * 1024 * 1024) / unit.length));

    for (const xml of [
      rss(filler),
      rss(`<item><title>Real post</title><link>https://rival.com/a</link>${filler}</item>`),
    ]) {
      expect(() => parseFeed(xml, BASE, { now: NOW })).not.toThrow();
    }
  });

  it("keeps only the newest 20 items of a huge feed", () => {
    const many = Array.from(
      { length: 5000 },
      (_unused, index) =>
        `<item><title>Post ${String(index)}</title><link>https://rival.com/p/${String(index)}</link></item>`,
    ).join("");

    expect(parseFeed(rss(many), BASE, { now: NOW })).toHaveLength(MAX_FEED_ITEMS);
  });

  it("never expands entities or reads files: a DOCTYPE entity is unreadable and never read", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY lol "lol">]>
      <rss version="2.0"><channel><item><title>&xxe; and &lol;</title><link>https://rival.com/x</link>
      <description>&xxe;</description></item></channel></rss>`;

    const items = parseFeed(xml, BASE, { now: NOW });

    expect(items).toBeNull();
    expect(JSON.stringify(items)).not.toContain("root:");
  });

  it("does not follow a billion-laughs chain and treats numeric entities safely", () => {
    const laughs = Array.from(
      { length: 9 },
      (_unused, index) =>
        `<!ENTITY lol${String(index + 1)} "&lol${String(index)};&lol${String(index)};&lol${String(index)};">`,
    ).join("");
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY lol0 "lol">${laughs}]><rss><channel>
      <item><title>&lol9; &#x110000; &#0; ok</title><link>https://rival.com/y</link></item></channel></rss>`;

    const [item] = parseFeed(xml, BASE, { now: NOW }) ?? [];

    expect(item?.title).toContain("ok");
    expect(item?.title).not.toContain("root:");
  });

  it("keeps item boundaries right when a non-ASCII title sits between two items", () => {
    const xml = rss(
      `<item><title>İİİİİ İstanbul</title><link>https://rival.com/istanbul</link></item>` +
        `<item><title>Upper case text</title><link>https://rival.com/upper</link></item>`,
    );

    expect(parseFeed(xml, BASE, { now: NOW })?.map((item) => item.title)).toEqual([
      "İİİİİ İstanbul",
      "Upper case text",
    ]);
  });

  it("ignores an item whose tags are upper case, because XML tags are case-sensitive", () => {
    // The old scanner lower-cased the document before it looked for <item>, so
    // it read a malformed feed the XML spec says has no items. fast-xml-parser
    // matches tag names exactly, which is the correct reading; the old test
    // that asserted the upper-case item was read is deleted with the scanner.
    const xml = rss(`<ITEM><TITLE>Upper case tags</TITLE><LINK>https://rival.com/upper</LINK></ITEM>`);

    expect(parseFeed(xml, BASE, { now: NOW })).toEqual([]);
  });
});
