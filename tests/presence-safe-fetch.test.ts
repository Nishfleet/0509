import { describe, expect, it, vi } from "vitest";

import { presenceSafeFetch } from "~/lib/presence-robots.server";

describe("presence safe fetch", () => {
  it("blocks localhost targets", async () => {
    const fetchImpl = vi.fn();
    const result = await presenceSafeFetch("http://127.0.0.1/secret", fetchImpl as typeof fetch, {
      maxBytes: 10_000,
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks redirect chains to private hosts", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.redirect("http://127.0.0.1/private", 302),
    );
    const result = await presenceSafeFetch("https://example.com/start", fetchImpl as typeof fetch, {
      maxBytes: 10_000,
    });
    expect(result).toBeNull();
  });

  it("rejects oversized content-length before download", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(20), {
        status: 200,
        headers: { "content-length": "99999999" },
      }),
    );
    const result = await presenceSafeFetch("https://example.com/big", fetchImpl as typeof fetch, {
      maxBytes: 100,
    });
    expect(result).toBeNull();
  });

  it("returns bounded response bodies", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("hello", { status: 200, headers: { etag: '"1"' } }),
    );
    const result = await presenceSafeFetch("https://example.com/page", fetchImpl as typeof fetch, {
      maxBytes: 10_000,
    });
    expect(result?.ok).toBe(true);
    expect(result?.body).toBe("hello");
    expect(result?.etag).toBe('"1"');
  });

  it("returns null when the fetch times out or rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    const result = await presenceSafeFetch("https://example.com/page", fetchImpl as typeof fetch, {
      maxBytes: 10_000,
    });

    expect(result).toBeNull();
  });

  it("returns null when the response body aborts while reading", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new DOMException("aborted", "AbortError"));
          },
        }),
        { status: 200 },
      ),
    );

    const result = await presenceSafeFetch("https://example.com/page", fetchImpl as typeof fetch, {
      maxBytes: 10_000,
    });

    expect(result).toBeNull();
  });
});
