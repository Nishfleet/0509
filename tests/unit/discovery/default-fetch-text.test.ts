import { afterEach, describe, expect, it, vi } from "vitest";

import { hnGenerator } from "../../../app/lib/discovery/generators/hn.server";
import { defaultFetchText } from "../../../app/lib/discovery/fetch-text.server";
import type { Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

function stubRejectingFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("socket hang up");
    }),
  );
}

function loggedEvents(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => (JSON.parse(String(call[0])) as { event: string }).event);
}

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const result = await defaultFetchText("discovery.test_event")("https://example.com/ok");

    expect(result).toEqual({
      ok: true,
      status: 200,
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const result = await defaultFetchText("discovery.test_event")("https://example.com/fail");

    expect(result).toEqual({
      ok: false,
      status: 500,
      url: "https://example.com/fail",
      contentType: "text/html",
      body: "server exploded",
    });
  });

  it("resolves a null-contentType empty-body miss when fetch rejects", async () => {
    stubRejectingFetch();

    const result = await defaultFetchText("discovery.test_event")("https://example.com/down");

    expect(result).toEqual({
      ok: false,
      status: 0,
      url: "https://example.com/down",
      contentType: null,
      body: "",
    });
  });

  it("logs one JSON line carrying the event the factory was given", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubRejectingFetch();

    await defaultFetchText("discovery.test_event")("https://example.com/down");

    expect(errorSpy).toHaveBeenCalledOnce();
    const line = errorSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    const parsed = JSON.parse(String(line)) as { event?: unknown };
    expect(parsed.event).toBe("discovery.test_event");
  });

  it("bounds the fetch with AbortSignal.timeout(8000)", async () => {
    const response = new Response("body", { status: 200, headers: { "content-type": "text/plain" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await defaultFetchText("discovery.test_event")("https://example.com/ok");

    expect(timeoutSpy).toHaveBeenCalledWith(8_000);
  });

  it("logs discovery.hn_fetch_failed from the hn generator's default fetch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubRejectingFetch();

    await expect(hnGenerator(SUBJECT)).rejects.toThrow("hn generator fetch failed with status 0");
    expect(loggedEvents(errorSpy)).toEqual(["discovery.hn_fetch_failed"]);
  });

  it("gives the hn generator's default fetch a five second timeout", async () => {
    const response = new Response("{}", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await hnGenerator(SUBJECT);

    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
  });
});
