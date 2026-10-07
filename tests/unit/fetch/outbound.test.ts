import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BlockedRedirectError,
  cappedJson,
  cappedText,
  windowedText,
  fetchOutbound,
  targetRefusal,
} from "../../../app/lib/fetch/outbound.server";

function streamed(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

function redirecting(status: number, location: string) {
  const fetchMock = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(new Response(null, { status, headers: { location } }))
    .mockResolvedValue(new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOutbound", () => {
  it("drops Authorization on a cross-origin hop and keeps it on a same-origin hop", async () => {
    const cross = redirecting(302, "https://other.example.com/next");
    await fetchOutbound("https://api.example.com/start", { headers: { authorization: "Bearer x", accept: "a" } });
    expect(new Headers(cross.mock.calls[1]?.[1].headers).has("authorization")).toBe(false);
    expect(new Headers(cross.mock.calls[1]?.[1].headers).get("accept")).toBe("a");

    const same = redirecting(302, "/next");
    await fetchOutbound("https://api.example.com/start", { headers: { authorization: "Bearer x" } });
    expect(new Headers(same.mock.calls[1]?.[1].headers).get("authorization")).toBe("Bearer x");
  });

  it("turns a POST into a GET without a body on 303, and keeps it on 307", async () => {
    const see = redirecting(303, "https://api.example.com/done");
    await fetchOutbound("https://api.example.com/start", { method: "POST", body: "{}", headers: {} });
    expect(see.mock.calls[1]?.[1]).toMatchObject({ method: "GET", body: undefined });

    const temp = redirecting(307, "https://api.example.com/again");
    await fetchOutbound("https://api.example.com/start", { method: "POST", body: "{}", headers: {} });
    expect(temp.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("keeps HEAD a HEAD across a redirect and refuses a non-public hop", async () => {
    const head = redirecting(301, "https://www.example.com/");
    await fetchOutbound("https://example.com/", { method: "HEAD", headers: {} });
    expect(head.mock.calls[1]?.[1]).toMatchObject({ method: "HEAD" });

    redirecting(302, "http://169.254.169.254/");
    await expect(fetchOutbound("https://example.com/", { headers: {} })).rejects.toBeInstanceOf(BlockedRedirectError);
  });

  it("refuses a non-public first hop without calling fetch", async () => {
    const fetchMock = redirecting(200, "");
    await expect(fetchOutbound("http://169.254.169.254/latest", { headers: {} })).rejects.toBeInstanceOf(
      BlockedRedirectError,
    );
    await expect(fetchOutbound("https://foo.localhost/", { headers: {} })).rejects.toBeInstanceOf(BlockedRedirectError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("targetRefusal", () => {
  it("accepts a public ICANN http(s) host", () => {
    expect(targetRefusal(new URL("https://example.com/"))).toBeNull();
    expect(targetRefusal(new URL("http://www.example.co.uk/"))).toBeNull();
  });

  it("refuses a scheme that is not in the allow-list", () => {
    expect(targetRefusal(new URL("ftp://example.com/"))).toBe("unsupported scheme: ftp:");
    expect(targetRefusal(new URL("http://example.com/"), ["https:"])).toBe("unsupported scheme: http:");
  });

  it("refuses a host that is an IP address", () => {
    for (const raw of ["https://127.0.0.1/", "https://10.0.0.5/", "https://[::1]/"]) {
      expect(targetRefusal(new URL(raw))).toMatch(/^not a public internet host: /);
    }
  });

  it("refuses a host that is not a public ICANN domain", () => {
    for (const raw of ["https://localhost/", "https://intranet/", "https://printer.local/"]) {
      expect(targetRefusal(new URL(raw))).toMatch(/^not a public internet host: /);
    }
  });
});

describe("cappedText and cappedJson", () => {
  it("returns the decoded body when it is within the cap", async () => {
    expect(await cappedText(new Response("héllo"), 64)).toBe("héllo");
    expect(await cappedJson(new Response('{"a":1}'), 64)).toEqual({ a: 1 });
  });

  it("returns null when content-length declares more than the cap", async () => {
    const res = new Response("small", { headers: { "content-length": "1000" } });
    expect(await cappedText(res, 10)).toBeNull();
    const json = new Response("{}", { headers: { "content-length": "1000" } });
    expect(await cappedJson(json, 10)).toBeNull();
  });

  it("returns null when the stream exceeds the cap without a content-length", async () => {
    expect(await cappedText(streamed(["aaaaaa", "bbbbbb"]), 10)).toBeNull();
    expect(await cappedText(streamed(["aaaaa", "bbbbb"]), 10)).toBe("aaaaabbbbb");
  });
});

describe("windowedText", () => {
  it("returns the whole body as both windows when it is within the window size", async () => {
    expect(await windowedText(new Response("héllo"), 64, 128)).toEqual({
      head: "héllo",
      tail: "héllo",
      truncated: false,
    });
    expect(await windowedText(new Response(null), 64, 128)).toEqual({ head: "", tail: "", truncated: false });
  });

  it("keeps the first and the last window of a body larger than one window", async () => {
    const res = streamed(["aaaaaa", "bbbbbb", "cccccc"]);
    expect(await windowedText(res, 10, 64)).toEqual({ head: "aaaaaabbbb", tail: "bbbbcccccc", truncated: false });
  });

  it("stops at the stream cap and windows what it read", async () => {
    const res = streamed(["aaaaaa", "bbbbbb", "cccccc", "dddddd"]);
    expect(await windowedText(res, 6, 18)).toEqual({ head: "aaaaaa", tail: "cccccc", truncated: true });
  });

  it("ignores an oversized content-length and windows the real stream", async () => {
    const declared = new Response("abcdefghijklmnopqrst", { headers: { "content-length": "1000" } });
    expect(await windowedText(declared, 8, 64)).toEqual({ head: "abcdefgh", tail: "mnopqrst", truncated: false });
  });
});
