import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
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

describe("captureLandingPageSnapshot Browser Run fallback", () => {
  it("rejects private initial URLs before fetch or render", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    for (const url of [
      "http://127.0.0.1/admin",
      "http://[::ffff:127.0.0.1]/admin",
      "http://[::ffff:7f00:1]/admin",
      "http://[::ffff:a9fe:a9fe]/metadata",
    ]) {
      await expect(
        captureLandingPageSnapshot({ BROWSERLESS_TOKEN: "browserless-token" }, url),
      ).resolves.toBeNull();
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects public-looking hostnames that resolve to private addresses", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () => new Response("ok")) as never,
      {
        "127.0.0.1.nip.io": {
          A: ["127.0.0.1"],
        },
      },
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot(
        { BROWSERLESS_TOKEN: "browserless-token" },
        "http://127.0.0.1.nip.io/admin",
      ),
    ).resolves.toBeNull();

    expect(nonDnsFetchCalls(fetch)).toHaveLength(0);
  });

  it("does not follow redirects to private URLs", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1/admin",
          },
        }),
      ) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(
      captureLandingPageSnapshot({ BROWSERLESS_TOKEN: "browserless-token" }, "https://example.com/start"),
    ).resolves.toBeNull();

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("prefers rendered proof after the safe fetch path validates the URL", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response("<html><head><title>Raw page</title></head><body>Raw offer</body></html>", {
          status: 200,
        }),
      ) as never,
    );
    const captureRenderedLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/glow",
      canonicalUrl: "https://example.com/glow",
      rawHeadline: "Rendered offer",
      normalizedHeadline: "rendered offer",
      normalizedHeadlineHash: "hash-rendered",
      ctaText: "Claim rendered deal",
      priceText: "Rendered price",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-06-05T00:00:00.000Z",
      artifactKey: "landing-pages/rendered.html",
      metadata: {
        screenshotArtifactKey: "landing-pages/rendered.jpeg",
      },
    });
    vi.doMock("~/lib/browser-run.server", () => ({
      captureRenderedLandingPageSnapshot,
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot({}, "https://example.com/glow", {
      preferRendered: true,
    });

    expect(captureRenderedLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/glow",
    );
    expect(snapshot).toMatchObject({
      captureMethod: "browser_render",
      rawHeadline: "Rendered offer",
      metadata: expect.objectContaining({
        screenshotArtifactKey: "landing-pages/rendered.jpeg",
      }),
    });
  });

  it("captures a real browser-rendered proof bundle when fetch fails", async () => {
    mockFetchWithDns(vi.fn(async () => {
      throw new Error("fetch failed");
    }) as never);

    const page = {
      goto: vi.fn(),
      on: vi.fn(),
      setUserAgent: vi.fn(),
      setRequestInterception: vi.fn(),
      setViewport: vi.fn(),
      content: vi.fn().mockResolvedValue(`
        <html>
          <head>
            <title>Glow Serum Sale</title>
          </head>
          <body>
            <button>Shop now</button>
            <p>Starting at ₹499 only today</p>
            <form action="/lead">
              <input name="phone" />
              <input type="submit" value="Get Offer" />
            </form>
          </body>
        </html>
      `),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      url: vi.fn().mockReturnValue("https://example.com/glow?ref=browser"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    const put = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch },
    }));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSER: {} as Fetcher,
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith("https://example.com/glow", expect.any(Object));
    expect(snapshot).toMatchObject({
      rawHeadline: "Glow Serum Sale",
      normalizedHeadlineHash: expect.any(String),
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
      captureMethod: "browser_render",
      artifactKey: expect.stringContaining(".html"),
      metadata: expect.objectContaining({
        htmlArtifactKey: expect.stringContaining(".html"),
        screenshotArtifactKey: expect.stringContaining(".jpeg"),
        renderMode: "mobile",
        deviceProfile: "mobile_default",
        renderProvider: "cloudflare_browser_run",
        extractorVersion: "lp-signals-v1",
        extractionWarnings: [],
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: 0.9,
          priceText: 0.85,
          formPresent: 0.9,
        },
      }),
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalled();
  });

  it("uses Browserless as rendered proof fallback when fetch and Browser Run are unavailable", async () => {
    const screenshotBytes = new Uint8Array([8, 5, 0, 9]);
    const put = vi.fn().mockResolvedValue(undefined);
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("browserless.io/stealth/bql")) {
          throw new Error("fetch failed");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <head>
                      <title>Nykaa onboarding bundle</title>
                    </head>
                    <body>
                      <a href="/offer">Claim deal</a>
                      <p>Up to 30% off this week</p>
                      <form>
                        <input name="email" />
                        <button type="submit">Submit</button>
                      </form>
                    </body>
                  </html>
                `,
              },
              screenshot: {
                base64: btoa(String.fromCharCode(...screenshotBytes)),
              },
              documentRequests: [
                {
                  url: "https://www.example.com/glow",
                },
              ],
              url: {
                url: "https://www.example.com/glow",
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }) as never,
    );

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    const snapshot = await captureLandingPageSnapshot(
      {
        BROWSERLESS_TOKEN: "browserless-token",
        BROWSERLESS_PROOF_ALLOWLIST_ORIGINS: "https://example.com https://www.example.com",
        LANDING_PAGE_ARTIFACTS: { put } as unknown as R2Bucket,
      },
      "https://example.com/glow",
    );

    const pageFetches = nonDnsFetchCalls(fetch);
    expect(pageFetches[0]).toEqual(["https://example.com/glow", expect.any(Object)]);
    expect(pageFetches[1]).toEqual([
      expect.stringContaining("browserless.io/stealth/bql"),
      expect.objectContaining({
        method: "POST",
      }),
    ]);
	  expect(snapshot).toMatchObject({
	    rawHeadline: "Nykaa onboarding bundle",
	    ctaText: "Claim deal",
      priceText: "Up to 30% off",
      formPresent: true,
      captureMethod: "browser_render",
      canonicalUrl: "https://www.example.com/glow",
      metadata: expect.objectContaining({
        htmlArtifactKey: expect.stringContaining(".html"),
        screenshotArtifactKey: expect.stringContaining(".jpeg"),
        renderProvider: "browserless_bql",
      }),
	  });
	  expect(put).toHaveBeenCalledTimes(2);
	});

	it("does not send arbitrary proof URLs to Browserless without an allowlist", async () => {
	  const fetch = mockFetchWithDns(
	    vi.fn(async (input) => {
	      if (String(input).includes("browserless.io/stealth/bql")) {
	        return new Response(JSON.stringify({ data: {} }), { status: 200 });
	      }

	      throw new Error("fetch failed");
	    }) as never,
	  );

	  const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

	  await expect(
	    captureLandingPageSnapshot(
	      {
	        BROWSERLESS_TOKEN: "browserless-token",
	      },
	      "https://example.com/glow",
	    ),
	  ).resolves.toBeNull();

	  expect(nonDnsFetchCalls(fetch).some(([input]) => String(input).includes("browserless.io"))).toBe(false);
	});

	it("fails honestly when fetch fails and Browser Run is unavailable", async () => {
	  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { captureLandingPageSnapshot } = await import("~/lib/landing-pages.server");

    await expect(captureLandingPageSnapshot({}, "https://example.com/glow")).resolves.toBeNull();
  });
});
