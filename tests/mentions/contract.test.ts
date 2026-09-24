import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "../../workers/sources/registry";
import { fetchUpstream, mentionItemSchema, webItems } from "../../workers/sources/mentions/types";

const hnFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/hn-gymshark.json"),
  "utf8",
);

const gdeltBody = JSON.stringify({
  articles: [
    {
      url: "https://www.example-news.com/gymshark-opens-store",
      title: "Gymshark opens a new flagship store",
      seendate: "20260923T101500Z",
      domain: "example-news.com",
    },
    {
      url: "javascript:alert(1)",
      title: "Not a web link",
      seendate: "20260923T101500Z",
      domain: "evil.example",
    },
  ],
});

function stubFetch(body: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mentions adapter contract", () => {
  it("accepts only http and https links", () => {
    const base = { dedupKey: "a", title: "t", publisher: null, publishedAt: null };
    expect(mentionItemSchema.safeParse({ ...base, url: "https://example.com/a" }).success).toBe(true);
    expect(mentionItemSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
    expect(webItems([{ ...base, url: "data:text/html,x" }, { ...base, url: "http://example.com" }])).toHaveLength(1);
  });

  it("fetchUpstream names 0509 and sets a timeout", async () => {
    const fetchMock = stubFetch("ok");
    await fetchUpstream("https://example.com/feed");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/feed", {
      headers: { "User-Agent": "0509.io/1.0 (https://0509.io)" },
      signal: expect.any(AbortSignal),
    });
  });

  it("the registry knows GDELT and Hacker News and nothing else", () => {
    expect(adapterFor("gdelt.doc")).toBeTypeOf("function");
    expect(adapterFor("hn.algolia")).toBeTypeOf("function");
    expect(adapterFor("news.google_rss")).toBeUndefined();
  });
});

describe("gdelt adapter", () => {
  it("returns real article links with publisher and time, dropping non-web links", async () => {
    const fetchMock = stubFetch(gdeltBody);
    const result = await adapterFor("gdelt.doc")?.({ query: "Gymshark" });
    expect(String(fetchMock.mock.calls[0]?.at(0))).toContain(encodeURIComponent('"Gymshark"'));
    expect(result?.items).toEqual([
      {
        dedupKey: "https://www.example-news.com/gymshark-opens-store",
        url: "https://www.example-news.com/gymshark-opens-store",
        title: "Gymshark opens a new flagship store",
        publisher: "example-news.com",
        publishedAt: "2026-09-23T10:15:00Z",
      },
    ]);
    expect(result?.rawBody).toBe(gdeltBody);
  });

  it("treats an empty answer as no articles", async () => {
    stubFetch("{}");
    const result = await adapterFor("gdelt.doc")?.({ query: "Nobody" });
    expect(result?.items).toEqual([]);
  });

  it("fails loudly on a text answer or an error status", async () => {
    stubFetch("Please limit requests to one every 5 seconds");
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" })).rejects.toThrow(/not JSON/);
    stubFetch("", 429);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" })).rejects.toThrow(/429/);
  });
});

describe("hacker news adapter", () => {
  it("reads stories with their links, falling back to the discussion page", async () => {
    stubFetch(hnFixture);
    const result = await adapterFor("hn.algolia")?.({ query: "gymshark" });
    const items = result?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({
      dedupKey: "42603967",
      url: "https://www.theguardian.com/business/2025/jan/05/uniqlo-gymshark-and-lush-stop-hiring-uk-workers-via-gig-economy-apps",
      publisher: "Hacker News",
      publishedAt: "2025-01-05T18:49:30Z",
    });
    expect(items.every((item) => /^https?:\/\//.test(item.url))).toBe(true);
  });

  it("uses the discussion page when a story has no link", async () => {
    stubFetch(JSON.stringify({ hits: [{ objectID: "7", title: "Ask HN: Gymshark?", url: null }] }));
    const result = await adapterFor("hn.algolia")?.({ query: "gymshark" });
    expect(result?.items[0]?.url).toBe("https://news.ycombinator.com/item?id=7");
  });
});
