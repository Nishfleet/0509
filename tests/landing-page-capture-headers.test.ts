import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/**
 * The landing-page capture is the "real proof" pipeline's rawest link: a
 * saved snapshot is only evidence if the request that produced it was honest
 * (no private bounce, a verifiable user-agent, a bounded retry that keeps
 * transient 5xx/429 blips from silently failing a capture). These tests lock
 * the request headers and retry behavior of `captureLandingPageSnapshot` so
 * a refactor can never turn a real capture into an unverifiable or
 * fabricating one.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/browser-run.server");
});

function mockFetchWithDns(
  handler: typeof fetch,
  records: Record<string, { A?: string[]; AAAA?: string[] }> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const hostname = parsed.searchParams.get("name") ?? "";
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = records[hostname]?.[type] ?? (type === "A" ? ["93.184.216.34"] : []);
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({
            data: address,
            type: type === "A" ? 1 : 28,
          })),
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/dns-json",
          },
        },
      );
    }

    return handler(input, init);
  });
}

function nonDnsFetchCalls(fetch: ReturnType<typeof mockFetchWithDns>) {
  return fetch.mock.calls.filter(([input]) => !String(input).startsWith(DNS_JSON_ENDPOINT));
}

describe("captureLandingPageSnapshot request headers", () => {
  it("captures with the bot user-agent and manual redirects", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          "<html><head><title>Header check</title></head><body><a href=\"/buy\">Buy now</a></body></html>",
          { status: 200 },
        ),
      ) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/headers");

    expect(snapshot).toMatchObject({
      rawHeadline: "Header check",
      captureMethod: "landing_page_fetch",
    });
    // Exactly one non-DNS fetch: the landing page itself. No DNS, no
    // telemetry, no rendered fallback.
    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/headers",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          "user-agent": "0509-bot/1.0 (+https://0509.io)",
        }),
      }),
    );
  });

  it("keeps the same user-agent and manual redirects on the transient retry", async () => {
    let calls = 0;
    const fetch = mockFetchWithDns(
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("boom", { status: 500 });
        }
        return new Response(
          "<html><head><title>Retry check</title></head><body><a href=\"/buy\">Buy now</a></body></html>",
          { status: 200 },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/retry-headers");

    expect(snapshot).toMatchObject({
      rawHeadline: "Retry check",
      metadata: expect.objectContaining({ fetchAttempts: 2 }),
    });
    const pageFetches = nonDnsFetchCalls(fetch);
    expect(pageFetches).toHaveLength(2);
    for (const [, init] of pageFetches) {
      expect(init).toEqual(
        expect.objectContaining({
          redirect: "manual",
          headers: expect.objectContaining({
            "user-agent": "0509-bot/1.0 (+https://0509.io)",
          }),
        }),
      );
    }
  });

  it("tracks a redirect chain but never lets the retry double-fetch a redirect", async () => {
    let calls = 0;
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        calls += 1;
        if (String(input) === "https://example.com/start") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://example.com/final" },
          });
        }
        return new Response(
          "<html><head><title>Final page</title></head><body><a href=\"/buy\">Buy now</a></body></html>",
          { status: 200 },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/start");

    expect(snapshot).toMatchObject({
      rawHeadline: "Final page",
      canonicalUrl: "https://example.com/final",
    });
    const pageFetches = nonDnsFetchCalls(fetch);
    expect(pageFetches.map(([input]) => String(input))).toEqual([
      "https://example.com/start",
      "https://example.com/final",
    ]);
    expect(calls).toBe(2);
    // The 302 is a hop, not a transient failure: it must never be retried.
    expect(pageFetches[0][1]).toEqual(
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not follow a redirect to a private URL (SSRF guard on the hop)", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        }),
      ) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const onFailure = vi.fn();
    await expect(
      captureLandingPageSnapshot({}, "https://example.com/start", { onFailure }),
    ).resolves.toBeNull();

    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "landing_redirect_blocked" }),
    );
    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
  });
});
