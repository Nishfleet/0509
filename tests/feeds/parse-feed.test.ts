import { describe, expect, it } from "vitest";

import {
  MAX_FEED_ITEMS,
  attributes,
  hashItemKeys,
  isFeedDocument,
  itemKey,
  keyItems,
  parseFeed,
} from "../../app/lib/feeds/parse-feed";

const NOW = new Date("2026-10-02T03:00:00Z");
const BASE = "https://rival.com/feed";

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Rival blog</title><link>https://rival.com/</link>${items}</channel></rss>`;

const atom = (entries: string) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Rival changelog</title>${entries}</feed>`;

describe("parseFeed", () => {
  it("reads an RSS 2.0 item: title, link, guid, date and a plain-text excerpt", () => {
    const items = parseFeed(
      rss(`<item><title>Launching Rival 2</title><link>https://rival.com/blog/2</link>
        <guid isPermaLink="false">post-2</guid><pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<p>The <b>biggest</b> release &amp; more.</p>]]></description></item>`),
      BASE,
      NOW,
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
      NOW,
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
        NOW,
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
      NOW,
    );
    expect(items?.map((item) => item.title)).toEqual(["Fine"]);
  });

  it("drops items older than 30 days but keeps undated ones", () => {
    const items = parseFeed(
      rss(`<item><title>Old</title><link>https://rival.com/old</link><pubDate>Mon, 31 Aug 2026 10:00:00 GMT</pubDate></item>
        <item><title>Edge</title><link>https://rival.com/edge</link><pubDate>Sun, 06 Sep 2026 10:00:00 GMT</pubDate></item>
        <item><title>Undated</title><link>https://rival.com/undated</link></item>`),
      BASE,
      NOW,
    );
    expect(items?.map((item) => item.title)).toEqual(["Edge", "Undated"]);
  });

  it("sorts newest first and caps the list at the newest 20", () => {
    const many = Array.from(
      { length: 30 },
      (_unused, index) =>
        `<item><title>Post ${String(index)}</title><link>https://rival.com/p/${String(index)}</link><pubDate>${new Date(Date.UTC(2026, 8, 20, index)).toUTCString()}</pubDate></item>`,
    ).join("");
    const items = parseFeed(rss(many), BASE, NOW) ?? [];
    expect(items).toHaveLength(MAX_FEED_ITEMS);
    expect(items[0]?.title).toBe("Post 29");
    expect(items.at(-1)?.title).toBe("Post 10");
  });

  it("keeps one copy of an item that appears twice under the same guid", () => {
    const twice = `<item><title>Same</title><link>https://rival.com/s</link><guid>g1</guid></item>`;
    expect(parseFeed(rss(twice + twice), BASE, NOW)).toHaveLength(1);
  });

  it("truncates a long title and excerpt", () => {
    const [item] =
      parseFeed(
        rss(
          `<item><title>${"t".repeat(500)}</title><link>https://rival.com/l</link><description>${"d ".repeat(400)}</description></item>`,
        ),
        BASE,
        NOW,
      ) ?? [];
    expect(item?.title).toHaveLength(200);
    expect(item?.excerpt?.length).toBeLessThanOrEqual(200);
    expect(item?.excerpt?.endsWith("…")).toBe(true);
  });

  it("decodes numeric entities and ignores an out-of-range one", () => {
    const [item] =
      parseFeed(
        rss(`<item><title>A&#8217;s &#x41; &#99999999; plan</title><link>https://rival.com/e</link></item>`),
        BASE,
        NOW,
      ) ?? [];
    expect(item?.title).toBe("A’s A plan");
  });

  it("returns null for HTML, JSON and an empty body, and an empty list for a feed with no items", () => {
    expect(parseFeed("<!doctype html><html><body>hi</body></html>", BASE, NOW)).toBeNull();
    expect(parseFeed('{"items":[]}', BASE, NOW)).toBeNull();
    expect(parseFeed("", BASE, NOW)).toBeNull();
    expect(parseFeed(rss(""), BASE, NOW)).toEqual([]);
  });

  it("does not read the channel's own title or link as an item", () => {
    expect(parseFeed(rss(""), BASE, NOW)).toEqual([]);
  });
});

describe("isFeedDocument", () => {
  it("accepts rss and feed roots only", () => {
    expect(isFeedDocument("<?xml version='1.0'?><rss version='2.0'></rss>")).toBe(true);
    expect(isFeedDocument("<feed xmlns='http://www.w3.org/2005/Atom'></feed>")).toBe(true);
    expect(isFeedDocument("<html><body><feedback>x</feedback></body></html>")).toBe(false);
  });
});

describe("item keys", () => {
  it("hashes an id to the same 64-character key every time", async () => {
    const first = await itemKey("post-2");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await itemKey("post-2")).toBe(first);
    expect(await itemKey("post-3")).not.toBe(first);
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
});

const HOSTILE_CEILING_MS = 10_000;

describe("parseFeed on hostile input", () => {
  const TWO_MIB = 2 * 1024 * 1024;
  const timed = (xml: string) => {
    const started = performance.now();
    const items = parseFeed(xml, BASE, NOW);
    return { items, ms: performance.now() - started };
  };

  it.each([
    ["unclosed item tags", "<item>"],
    ["unclosed entry tags", "<entry>"],
    ["unclosed link tags inside one item", "<link>"],
    ["unclosed CDATA openers", "<![CDATA["],
    ["bare angle brackets", "<"],
    ["unclosed title and description tags", "<title><description>"],
  ])("stays fast on a 2 MiB feed of %s", (_label, unit) => {
    const filler = unit.repeat(Math.floor(TWO_MIB / unit.length));
    const documents = [
      rss(filler),
      rss(`<item><title>Real post</title><link>https://rival.com/a</link>${filler}</item>`),
      rss(`<item>${filler}`),
    ];

    for (const xml of documents) {
      const { ms } = timed(xml);
      expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
    }
  });

  it("keeps only the first 200 blocks and the newest 20 items of a huge feed", () => {
    const many = Array.from(
      { length: 5000 },
      (_, i) => `<item><title>Post ${i}</title><link>https://rival.com/p/${i}</link></item>`,
    ).join("");

    const { items, ms } = timed(rss(many));

    expect(items).toHaveLength(MAX_FEED_ITEMS);
    expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
  });

  it("skips an item block over the size cap and still reads the next one", () => {
    const huge = `<item><title>Huge</title><link>https://rival.com/huge</link><description>${"x".repeat(30_000)}</description></item>`;
    const fine = "<item><title>Fine</title><link>https://rival.com/fine</link></item>";

    expect(parseFeed(rss(huge + fine), BASE, NOW)?.map((item) => item.title)).toEqual(["Fine"]);
  });

  it("never expands entities or reads files: a DOCTYPE entity stays literal text", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY lol "lol">]>
      <rss version="2.0"><channel><item><title>&xxe; and &lol;</title><link>https://rival.com/x</link>
      <description>&xxe;</description></item></channel></rss>`;

    const items = parseFeed(xml, BASE, NOW);

    expect(items).toHaveLength(1);
    expect(items?.[0]?.title).toBe("&xxe; and &lol;");
    expect(items?.[0]?.excerpt).toBe("&xxe;");
    expect(JSON.stringify(items)).not.toContain("root:");
  });

  it("does not follow a billion-laughs chain and treats numeric entities safely", () => {
    const laughs = Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "&lol${i};&lol${i};&lol${i};">`).join("");
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY lol0 "lol">${laughs}]><rss><channel>
      <item><title>&lol9; &#x110000; &#0; ok</title><link>https://rival.com/y</link></item></channel></rss>`;

    const { items, ms } = timed(xml);

    expect(items?.[0]?.title).toBe("&lol9; ok");
    expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
  });

  it("stays fast on a feed of many link tags with very long attribute runs", () => {
    const longRun = "a".repeat(1990);
    const noQuotes = `<link ${longRun}>`.repeat(1000);
    const manyNames = `<link ${"x=1 ".repeat(450)}>`.repeat(1000);
    const unclosedQuote = `<link href="${longRun}>`.repeat(1000);

    for (const filler of [noQuotes, manyNames, unclosedQuote]) {
      const { ms } = timed(rss(`<item><title>Real</title>${filler}<link>https://rival.com/a</link></item>`));
      expect(ms).toBeLessThan(HOSTILE_CEILING_MS);
    }
  });

  it("keeps item boundaries right when lowercasing would change a character's length", () => {
    const xml = rss(
      `<item><title>İİİİİ İstanbul</title><link>https://rival.com/istanbul</link></item>` +
        `<ITEM><TITLE>Upper case tags</TITLE><LINK>https://rival.com/upper</LINK></ITEM>`,
    );

    expect(parseFeed(xml, BASE, NOW)?.map((item) => item.title)).toEqual(["İİİİİ İstanbul", "Upper case tags"]);
  });
});

describe("attributes", () => {
  it("reads quoted attributes of either quote style, the first of a repeated name, and skips unquoted ones", () => {
    const found = attributes(` href="https://rival.com/a?x=1&amp;y=2" REL='alternate' href="ignored" bare data=nope`);

    expect(Object.fromEntries(found)).toEqual({ href: "https://rival.com/a?x=1&y=2", rel: "alternate" });
  });

  it("gives up cleanly on an unclosed quote", () => {
    expect(Object.fromEntries(attributes(`rel="alternate" href="https://rival.com/never-closed`))).toEqual({
      rel: "alternate",
    });
  });
});
