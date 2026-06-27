import { describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "~/lib/fetch-timeout.server";

describe("fetchWithTimeout", () => {
  it("adds an abort signal and cancels slow requests", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );

    const request = fetchWithTimeout("https://example.com", {}, {
      fetcher: fetcher as typeof fetch,
      timeoutMs: 25,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    vi.useRealTimers();
  });

  it("keeps the timeout active while the response body is read", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(body);
    });

    const response = await fetchWithTimeout("https://example.com", {}, {
      fetcher: fetcher as typeof fetch,
      timeoutMs: 25,
    });
    const bodyRead = expect(response.text()).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(25);
    await bodyRead;
    vi.useRealTimers();
  });
});
