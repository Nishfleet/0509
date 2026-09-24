import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "../../workers/sources/registry";

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

describe("gdelt adapter", () => {
  it("returns real article links with publisher and time, dropping non-web links", async () => {
    const fetchMock = stubFetch(gdeltBody);
    const result = await adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
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
    expect(result?.canaryCount).toBe(2);
    expect(result?.rawBody).toBe(gdeltBody);
  });

  it("treats an empty answer as no articles", async () => {
    stubFetch("{}");
    const result = await adapterFor("gdelt.doc")?.({ query: "Nobody" }, null);
    expect(result?.items).toEqual([]);
  });

  it("fails loudly on a text answer or an error status", async () => {
    stubFetch("Please limit requests to one every 5 seconds");
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/not JSON/);
    stubFetch("", 429);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/429/);
  });
});
