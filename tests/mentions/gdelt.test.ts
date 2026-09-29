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
  vi.restoreAllMocks();
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

  it("gives GDELT 24 seconds before the request is aborted", async () => {
    stubFetch(gdeltBody);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    expect(timeoutSpy).toHaveBeenCalledWith(24_000);
  });

  it("retries the request once after a timeout", async () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValue(new Response(gdeltBody));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.items).toHaveLength(1);
  });

  it("gives up after one retry when every attempt times out", async () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchMock = vi.fn(async () => {
      throw timeoutError;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(
      "aborted due to timeout",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a blocking status", async () => {
    const fetchMock = stubFetch("", 429);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails loudly on a text answer or an error status", async () => {
    stubFetch("Please limit requests to one every 5 seconds");
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/not JSON/);
    stubFetch("", 429);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/429/);
  });
});
