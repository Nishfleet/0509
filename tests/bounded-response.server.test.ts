import { describe, expect, it, vi } from "vitest";

import {
  readRequestTextWithinLimit,
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
} from "~/lib/bounded-response.server";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";

describe("bounded response readers", () => {
  it("returns exact-boundary text", async () => {
    await expect(readResponseTextWithinLimit(new Response("hello"), 5)).resolves.toBe("hello");
  });

  it("returns null for invalid JSON", async () => {
    await expect(readResponseJsonWithinLimit(new Response("{not-json"), 100)).resolves.toBeNull();
  });

  it("returns null when JSON response bodies abort after headers", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("body aborted"));
        },
      }),
    );

    await expect(readResponseJsonWithinLimit(response, 100)).resolves.toBeNull();
  });

  it("rejects oversized content-length without reading the body", async () => {
    const response = new Response("still not read", {
      headers: { "content-length": "1000" },
    });

    await expect(readResponseTextWithinLimit(response, 10)).resolves.toBeNull();
  });

  it("cancels stream bodies that exceed the byte limit", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("abcdef"));
          controller.close();
        },
      }),
    );

    await expect(readResponseTextWithinLimit(response, 5)).resolves.toBeNull();
  });

  it("releases fetch timeout cleanup on content-length early returns", async () => {
    vi.useFakeTimers();
    const response = await fetchWithTimeout(
      "https://example.com",
      {},
      {
        timeoutMs: 25,
        fetcher: vi.fn().mockResolvedValue(
          new Response("oversized", {
            headers: { "content-length": "1000" },
          }),
        ) as typeof fetch,
      },
    );

    await expect(readResponseTextWithinLimit(response, 10)).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("returns null for request bodies with oversized content-length", async () => {
    const request = new Request("https://0509.io/api/webhooks/dodo", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "not read",
    });

    await expect(readRequestTextWithinLimit(request, 10)).resolves.toBeNull();
  });

  it("cancels request streams that exceed the byte limit", async () => {
    const request = new Request("https://0509.io/api/webhooks/dodo", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("abcdef"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readRequestTextWithinLimit(request, 5)).resolves.toBeNull();
  });
});
