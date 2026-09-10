import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/**
 * Issue #1538: the top-3 bail-out reasons from the first day of real
 * `cta_pipeline_bail_reason_counts` data (landing_blocked,
 * landing_content_empty_or_oversized, landing_http_error) each get a fix:
 * narrowed reason codes for the statuses a browser render cannot rescue
 * (401/404/410), a truncating body read so oversized pages are parsed
 * instead of discarded, and an empty-body code of its own.
 *
 * These tests feed mock HTML exhibiting each bail pattern and assert the
 * fix either emits the field (truncated oversized page) or records a
 * specific, narrower bail reason.
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

function mockFetchWithDns(handler: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["93.184.216.34"] : [];
      return new Response(
        JSON.stringify({
          Answer: addresses.map((address) => ({ data: address, type: type === "A" ? 1 : 28 })),
        }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }
    return handler(input, init);
  });
}

function mockRender(result: unknown = null) {
  const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue(result);
  vi.doMock("~/lib/browser-run.server", () => ({ captureRenderedLandingPageSnapshot }));
  return captureRenderedLandingPageSnapshot;
}

async function captureWithFailure(url: string, failureCodes: string[]) {
  const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
  return captureLandingPageSnapshot({}, url, {
    onFailure: (detail) => {
      failureCodes.push(detail.reasonCode);
    },
  });
}

describe("landing-page fetch bail reasons (#1538)", () => {
  it("narrows a 401 to landing_auth_required and never spends a rendered leg on a login wall", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("<html><body>Sign in</body></html>", { status: 401 })) as never,
    );
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_auth_required"]);
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps landing_blocked for a 403 bot wall and still tries the rendered rescue", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response("<html><body>Access Denied</body></html>", { status: 403 }),
      ) as never,
    );
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_blocked"]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("narrows a 404 to landing_not_found and skips the render — a rendered 404 is still not the offer", async () => {
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response("<html><body>Page not found</body></html>", { status: 404 }),
      ) as never,
    );
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_not_found"]);
    expect(render).not.toHaveBeenCalled();
  });

  it("narrows a 410 to landing_gone and skips the render", async () => {
    mockFetchWithDns(
      vi.fn(async () => new Response("<html><body>Gone</body></html>", { status: 410 })) as never,
    );
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_gone"]);
    expect(render).not.toHaveBeenCalled();
  });

  it("narrows a persistent 5xx to landing_server_error after the transient retry", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html><body>Server error</body></html>", { status: 503 }),
    );
    mockFetchWithDns(fetchMock as never);
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_server_error"]);
    // 5xx is transient — the fetch is retried once, then the rendered leg runs.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keeps landing_http_error for an unnamed 4xx and still tries the rendered rescue", async () => {
    mockFetchWithDns(
      vi.fn(
        async () => new Response("<html><body>Bad request</body></html>", { status: 400 }),
      ) as never,
    );
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_http_error"]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("parses the first 1MB of an oversized page instead of bailing (emits the CTA field)", async () => {
    const head = `<html><head><title>Mega Store — Anniversary Sale</title></head><body>
      <main>
        <h1>Anniversary sale: 40% off everything</h1>
        <p>Real offer copy with enough text to count as meaningful body content for the landing page signal extractor and the capture-validity gate.</p>
        <button>Shop the sale</button>
      </main>`;
    // A >1MB inline JSON state blob after the real content — the classic
    // oversized landing page (e.g. brooklinen 1.8MB, milton.in 3.2MB).
    const padding = `<script type="application/json">${"x".repeat(1_200_000)}</script></body></html>`;
    mockFetchWithDns(
      vi.fn(
        async () =>
          new Response(head + padding, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ) as never,
    );
    const render = mockRender(null);

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");
    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/offer");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.captureMethod).toBe("landing_page_fetch");
    expect(snapshot?.rawHeadline).toBe("Mega Store — Anniversary Sale");
    expect(snapshot?.ctaText).toBe("Shop the sale");
    expect(snapshot?.metadata?.captureWarningCodes).toContain("landing_content_truncated");
    // The fetch leg produced a snapshot — no rendered leg was needed.
    expect(render).not.toHaveBeenCalled();
  });

  it("narrows a 0-byte body to landing_content_empty and still tries the rendered rescue", async () => {
    mockFetchWithDns(vi.fn(async () => new Response("", { status: 200 })) as never);
    const render = mockRender(null);

    const failureCodes: string[] = [];
    const snapshot = await captureWithFailure("https://example.com/offer", failureCodes);

    expect(snapshot).toBeNull();
    expect(failureCodes).toEqual(["landing_content_empty"]);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("readResponseTextCapped", () => {
  it("keeps the head of an oversized stream and marks it truncated", async () => {
    const { readResponseTextCapped } = await import("~/lib/bounded-response.server");
    const response = new Response("abcdefghij", { status: 200 });
    const result = await readResponseTextCapped(response, 4);
    expect(result).toEqual({ text: "abcd", truncated: true });
  });

  it("returns the full body when it fits under the cap", async () => {
    const { readResponseTextCapped } = await import("~/lib/bounded-response.server");
    const response = new Response("<html>ok</html>", { status: 200 });
    const result = await readResponseTextCapped(response, 1024);
    expect(result).toEqual({ text: "<html>ok</html>", truncated: false });
  });

  it("returns null for a genuinely empty body", async () => {
    const { readResponseTextCapped } = await import("~/lib/bounded-response.server");
    const response = new Response("", { status: 200 });
    const result = await readResponseTextCapped(response, 1024);
    expect(result).toBeNull();
  });
});
