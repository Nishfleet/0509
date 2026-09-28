import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultFetchText } from "../../../app/lib/discovery/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("defaultFetchText", () => {
  it("resolves ok with the response url, content type and body", async () => {
    const response = new Response("hello body", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    Object.defineProperty(response, "url", { value: "https://example.com/ok" });
    vi.stubGlobal("fetch", vi.fn(async () => response));

    const result = await defaultFetchText("discovery.test_event")("https://example.com/ok");

    expect(result).toEqual({
      ok: true,
      url: response.url,
      contentType: "text/plain",
      body: "hello body",
    });
  });

  it("resolves ok:false for a 500 with url, content type and body still populated", async () => {
    const response = new Response("server exploded", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: "https://example.com/fail" });
    vi.stubGlobal("fetch", vi.fn(async () => response));

    const result = await defaultFetchText("discovery.test_event")("https://example.com/fail");

    expect(result).toEqual({
      ok: false,
      url: "https://example.com/fail",
      contentType: "text/html",
      body: "server exploded",
    });
  });

  it("resolves a null-contentType empty-body miss and logs the factory's event when fetch rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hangup");
      }),
    );

    const result = await defaultFetchText("discovery.test_event")("https://example.com/down");

    expect(result).toEqual({
      ok: false,
      url: "https://example.com/down",
      contentType: null,
      body: "",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    const line = errorSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    const parsed = JSON.parse(String(line)) as { event?: unknown };
    expect(parsed.event).toBe("discovery.test_event");
  });
});
