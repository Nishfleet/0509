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
  const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(body, { status }));
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
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining(encodeURIComponent('"Gymshark"')));
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

  it("reports a phrase GDELT refuses as a query nobody can search, not a source failure", async () => {
    stubFetch("The specified phrase is too short.");
    await expect(adapterFor("gdelt.doc")?.({ query: "Gap" }, null)).rejects.toMatchObject({
      name: "UnsearchableQueryError",
    });
  });

  it("gives GDELT 24 seconds before the request is aborted", async () => {
    stubFetch(gdeltBody);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    expect(timeoutSpy).toHaveBeenCalledWith(24_000);
  });

  it("retries the request once after a timeout", async () => {
    const timedOut = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fetchMock = vi.fn().mockRejectedValueOnce(timedOut.reason).mockResolvedValue(new Response(gdeltBody));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.items).toHaveLength(1);
  });

  it("gives up after one retry when every attempt times out", async () => {
    const timedOut = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fetchMock = vi.fn(async () => {
      throw timedOut.reason;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow("aborted due to timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failure that is not a timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a ban", async () => {
    const fetchMock = stubFetch("", 403);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a rate limit answer and reads the answer that follows", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Please limit requests to one every 5 seconds", { status: 429 }))
      .mockResolvedValueOnce(new Response("Please limit requests to one every 5 seconds", { status: 429 }))
      .mockResolvedValue(new Response(gdeltBody));
    vi.stubGlobal("fetch", fetchMock);
    const pending = adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(await pending).toMatchObject({ canaryCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("waits at least five seconds between asks, as GDELT's own answer requires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    const outcome = pending?.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(String(await outcome)).toMatch(/429/);
    vi.useRealTimers();
  });

  it("gives up with the rate limit error after two more asks, each wait twice the last", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null);
    const outcome = pending?.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(String(await outcome)).toMatch(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("fails loudly on a text answer or an error status", async () => {
    stubFetch("Please limit requests to one every 5 seconds");
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/not JSON/);
    stubFetch("", 403);
    await expect(adapterFor("gdelt.doc")?.({ query: "Gymshark" }, null)).rejects.toThrow(/403/);
  });
});
