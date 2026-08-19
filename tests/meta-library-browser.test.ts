import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";

const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

function buildQuery() {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nykaa",
      country: "India",
      platform: "all" as const,
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
  };
}

function createBrowserHarness() {
  const evaluate = vi.fn().mockResolvedValue([
    {
      libraryId: "1234567890",
      advertiser: "Nykaa",
      body: "Flat 30% off on serums",
      previewHeadline: "Glow sale",
      previewSubhead: "Weekend only",
      cta: "Shop now",
      adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
      landingPageUrl: "https://www.nykaa.com/glow-sale",
      platforms: ["Instagram", "Facebook"],
      active: true,
    },
  ]);
  const page = {
    close: vi.fn().mockResolvedValue(undefined),
    evaluate,
    goto: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
  };
  const browserContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    createBrowserContext: vi.fn().mockResolvedValue(browserContext),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    browser,
    browserContext,
    page,
  };
}

function buildQuickActionContent(
  input: {
    cards?: Array<Record<string, unknown>>;
    loginWall?: boolean;
    noResults?: boolean;
    rateLimited?: boolean;
    withRunnerScript?: boolean;
  } = {},
) {
  const payload = {
    cards:
      input.cards ??
      [
        {
          libraryId: "1234567890",
          advertiser: "Nykaa",
          body: "Flat 30% off on serums",
          previewHeadline: "Glow sale",
          previewSubhead: null,
          cta: "Shop now",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          platforms: ["Instagram", "Facebook"],
          active: true,
        },
      ],
    loginWall: input.loginWall ?? false,
    noResults: input.noResults ?? false,
    rateLimited: input.rateLimited ?? false,
  };

  const runnerScript = input.withRunnerScript
    ? `<script id="__0509_ad_library_extractor" type="application/javascript">(() => { throw new Error("not payload"); })();</script>`
    : "";
  return `<html><body>${runnerScript}<script id="__0509_ad_library_payload" type="application/json">${JSON.stringify(payload).replace(/<\//g, "<\\/")}</script></body></html>`;
}

function mockFetchWithDns(handler: typeof fetch) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(DNS_JSON_ENDPOINT)) {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") === "AAAA" ? "AAAA" : "A";
      const addresses = type === "A" ? ["31.13.70.36"] : [];
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("searchMetaLibraryByBrowser", () => {
  it("maps requested status and creative filters into the Meta search URL", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { buildSearchUrl } = await import("~/lib/meta-library-browser.server");
    const query = {
      ...buildQuery(),
      filters: {
        ...buildQuery().filters,
        status: "inactive" as const,
        creativeType: "video" as const,
      },
    };

    const url = new URL(buildSearchUrl(query));

    expect(url.searchParams.get("active_status")).toBe("inactive");
    expect(url.searchParams.get("media_type")).toBe("video");

    const activeImageUrl = new URL(
      buildSearchUrl({
        ...query,
        filters: { ...query.filters, status: "active", creativeType: "image" },
      }),
    );
    expect(activeImageUrl.searchParams.get("active_status")).toBe("active");
    expect(activeImageUrl.searchParams.get("media_type")).toBe("image");

    const allUrl = new URL(buildSearchUrl(buildQuery()));
    expect(allUrl.searchParams.get("active_status")).toBe("all");
    expect(allUrl.searchParams.get("media_type")).toBe("all");

    const carouselUrl = new URL(
      buildSearchUrl({
        ...query,
        filters: { ...query.filters, creativeType: "carousel" },
      }),
    );
    expect(carouselUrl.searchParams.get("media_type")).toBe("all");
  });

  it("removes Meta UI lines before deriving hook and offer", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");
    const body = [
      "Active",
      "Library ID: 1234567890",
      "Started running on 1 Jul 2026",
      "Nykaa",
      "Sponsored",
      "Meet your new serum.",
      "BOGO weekend is here.",
      "Platforms",
      "Instagram",
      "Shop now",
    ].join("\n");

    const ad = normalizeExtractedCard(
      {
        libraryId: "1234567890",
        advertiser: "Nykaa",
        body,
        previewHeadline: "Serum launch",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        landingPageUrl: "https://www.nykaa.com/serum",
        platforms: ["Instagram"],
        active: true,
      },
      buildQuery(),
    );

    expect(ad.body).toBe("Meet your new serum.\nBOGO weekend is here.");
    expect(ad.hook).toBe("Meet your new serum.");
    expect(ad.offer).toBe("BOGO");
    expect(ad.offer).not.toBe(ad.body);
    expect(ad.body).not.toContain("Library ID");
    expect(ad.body).not.toContain("Started running");
  });

  it("does not turn an advertiser or Meta placeholder into ad analysis", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const ad = normalizeExtractedCard(
      {
        libraryId: "1234567890",
        advertiser: "Nykaa",
        body: "Active\nLibrary ID: 1234567890\nNykaa\nSponsored\nView ad details",
        previewHeadline: "Nykaa",
        previewSubhead: null,
        cta: null,
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        landingPageUrl: null,
        platforms: [],
        active: true,
      },
      buildQuery(),
    );

    expect(ad.body).toBe("");
    expect(ad.hook).toBe("");
    expect(ad.offer).toBe("");
  });

  it("never splits an emoji when deriving the preview subhead from a long body", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    // Units 0..118 are filler, unit 119 is the HIGH half of 🌟 (U+1F31F): a
    // plain body.slice(0, 120) would orphan it and the subhead would render
    // the U+FFFD replacement character on /search.
    const body = "a".repeat(119) + "🌟 French Pharmacy collection";

    const ad = normalizeExtractedCard(
      {
        libraryId: "1234567890",
        advertiser: "Nykaa",
        body,
        previewHeadline: "French Pharmacy collection",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        landingPageUrl: "https://www.nykaa.com",
        platforms: ["Instagram"],
        active: true,
      },
      buildQuery(),
    );

    // The truncated subhead stays well-formed: the dangling high surrogate is
    // dropped instead of being persisted as "�".
    expect(ad.previewSubhead).toBe("a".repeat(119));
    expect(/[\uD800-\uDFFF]/.test(ad.previewSubhead)).toBe(false);
    expect(ad.previewSubhead.includes("\uFFFD")).toBe(false);
    // The full body keeps the real emoji untouched for the detail pane.
    expect(ad.body).toContain("🌟");
  });

  it("keeps a real emoji intact when the body fits inside the subhead cap", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const body =
      "French Pharmacy collection ✨ " + "x".repeat(100) + " more copy";

    const ad = normalizeExtractedCard(
      {
        libraryId: "1234567891",
        advertiser: "Nykaa",
        body,
        previewHeadline: "French Pharmacy collection",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567891",
        landingPageUrl: "https://www.nykaa.com",
        platforms: ["Instagram"],
        active: true,
      },
      buildQuery(),
    );

    expect(ad.previewSubhead).toContain("✨");
    expect(/[\uD800-\uDFFF]/.test(ad.previewSubhead)).toBe(false);
  });

  it("post-filters cards whose observed active status contradicts the request", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({
      default: {},
    }));
    const { normalizeAndFilterExtractedCards } = await import(
      "~/lib/meta-library-browser.server"
    );
    const activeCard = {
      libraryId: "active-1",
      advertiser: "Nykaa",
      body: "Sponsored\nFresh serum.",
      previewHeadline: "Fresh serum",
      previewSubhead: null,
      cta: null,
      adSnapshotUrl: null,
      landingPageUrl: null,
      platforms: [],
      active: true,
    };
    const inactiveCard = { ...activeCard, libraryId: "inactive-1", active: false };
    const unknownCard = { ...activeCard, libraryId: "unknown-1", active: null };

    expect(
      normalizeAndFilterExtractedCards([activeCard], {
        ...buildQuery(),
        filters: { ...buildQuery().filters, status: "inactive" },
      }),
    ).toEqual([]);
    expect(
      normalizeAndFilterExtractedCards([inactiveCard], {
        ...buildQuery(),
        filters: { ...buildQuery().filters, status: "active" },
      }),
    ).toEqual([]);
    expect(
      normalizeAndFilterExtractedCards([unknownCard], {
        ...buildQuery(),
        filters: { ...buildQuery().filters, status: "inactive" },
      }),
    ).toEqual([
      expect.objectContaining({
        metaAdId: "unknown-1",
        active: false,
        activeStatusObserved: false,
      }),
    ]);
  });

  it("launches Browser Run without session reuse and normalizes Ad Library results", async () => {
    const { browser, browserContext, page } = createBrowserHarness();
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    expect(sessions).not.toHaveBeenCalled();
    expect(limits).toHaveBeenCalledWith({} as Fetcher);
    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("country=IN"),
      expect.objectContaining({
        waitUntil: "domcontentloaded",
        timeout: 20000,
      }),
    );
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining("q=nykaa"),
      expect.any(Object),
    );
    expect(page.waitForFunction).toHaveBeenCalled();
    const waitPredicate = page.waitForFunction.mock.calls[0][0] as (selector: string) => boolean;
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      body: {
        innerText: "Ad Library finished loading shell content",
      },
    });
    expect(waitPredicate("a[href]")).toBe(false);
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      body: {
        innerText: "No ads found for this query",
      },
    });
    expect(waitPredicate("a[href]")).toBe(true);
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      nextCursor: null,
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          previewHeadline: "Glow sale",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
          active: true,
          source: "meta_library_browser",
        }),
      ],
    });
    expect(browser.createBrowserContext).toHaveBeenCalled();
    expect(browserContext.close).toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it("does not reuse idle Browser Run sessions unless explicitly enabled", async () => {
    const { browser, page } = createBrowserHarness();
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([
      {
        sessionId: "session-1",
        startTime: 1000,
      },
    ]);
    const limits = vi.fn();
    const connect = vi.fn().mockResolvedValue(browser);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    expect(sessions).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(limits).toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
    expect(browser.close).toHaveBeenCalled();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it("can reuse an idle Browser Run session behind the explicit reuse flag", async () => {
    const { browser, page } = createBrowserHarness();
    const launch = vi.fn();
    const sessions = vi.fn().mockResolvedValue([
      {
        sessionId: "session-1",
        startTime: 1000,
      },
    ]);
    const limits = vi.fn();
    const connect = vi.fn().mockResolvedValue(browser);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_SESSION_REUSE: "1",
      },
      buildQuery(),
    );

    expect(connect).toHaveBeenCalledWith({} as Fetcher, "session-1");
    expect(launch).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
    expect(browser.disconnect).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("fails honestly when Browser Run is unavailable", async () => {
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(searchMetaLibraryByBrowser({}, buildQuery())).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "browser_unavailable",
    });
  });

  it("classifies Browser Run launch timeouts instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const launch = vi.fn(() => new Promise(() => undefined));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = expect(
      searchMetaLibraryByBrowser({ BROWSER: {} as Fetcher }, buildQuery()),
    ).rejects.toMatchObject({
      failureClass: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    vi.useRealTimers();
  });

  it("uses Browserless BQL as a live commercial fallback when Browser Run is unavailable", async () => {
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <article>
                        <strong>Nykaa</strong>
                        <span>Sponsored</span>
                        <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                        <a href="/ads/library/?id=1234567890">View ad details</a>
                        <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                      </article>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );
    const bqlFetch = nonDnsFetchCalls(fetchSpy)[0];
    const requestBody = JSON.parse(String(bqlFetch?.[1]?.body ?? "{}"));

    expect(String(bqlFetch?.[0])).toContain("/stealth/bql?token=browserless-token");
    expect(requestBody.variables).toMatchObject({
      userAgent: expect.stringContaining("iPhone"),
    });
    expect(requestBody.variables.selector).toBeUndefined();
    expect(requestBody.query).toContain("waitForTimeout");
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          body: "Flat 30% off on serums.",
          hook: "Flat 30% off on serums.",
          offer: "Flat 30% off",
          cta: "Shop now",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          source: "meta_library_browser",
        }),
      ],
    });
    expect(result.discoveryEmptyReason).toBeUndefined();
  });

	it("keeps rendered fallback dates attached to adjacent Library ID cards", async () => {
		mockFetchWithDns(
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						data: {
							html: {
                html: `
                  <html><body>
                    <div class="card">
                      <a href="/ads/library/?id=1111111111">View ad details</a>
                      <div>Active</div>
                      <div>Started running on 14 Jul 2025</div>
                      <div>Sponsored</div>
                      <strong>First advertiser</strong>
                    </div>
                    <div class="card">
                      <a href="/ads/library/?id=2222222222">View ad details</a>
                      <div>Active</div>
                      <div>Started running on 3 Aug 2025</div>
                      <div>Sponsored</div>
                      <strong>Second advertiser</strong>
                    </div>
                  </body></html>
                `,
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			) as never,
		);

		const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");
		const result = await searchMetaLibraryByBrowser({ BROWSERLESS_TOKEN: "browserless-token" }, buildQuery());

		expect(result.ads).toEqual([
			expect.objectContaining({ metaAdId: "1111111111", firstSeenAt: "2025-07-14" }),
			expect.objectContaining({ metaAdId: "2222222222", firstSeenAt: "2025-08-03" }),
		]);
	});

	it("keeps adjacent rendered fallback statuses with their Library ID cards", async () => {
		mockFetchWithDns(
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						data: {
							html: {
                html: `
                  <html><body>
                    <div class="card">
                      Active
                      Library ID: 3333333333
                      <a href="/ads/library/?id=3333333333">View ad details</a>
                      <div>Sponsored</div>
                      <strong>First advertiser</strong>
                    </div>
                    <div class="card">
                      Inactive
                      Library ID: 4444444444
                      <a href="/ads/library/?id=4444444444">View ad details</a>
                      <div>Sponsored</div>
                      <strong>Second advertiser</strong>
                    </div>
                  </body></html>
                `,
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			) as never,
		);

		const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");
		const result = await searchMetaLibraryByBrowser({ BROWSERLESS_TOKEN: "browserless-token" }, buildQuery());

		expect(result.ads).toEqual([
			expect.objectContaining({ metaAdId: "3333333333", active: true }),
			expect.objectContaining({ metaAdId: "4444444444", active: false }),
		]);
	});

  it("selects the smallest nested rendered card boundary for each ad anchor", async () => {
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const result = parseRenderedMetaLibraryHtml(`
      <main>
        <article role="article">
          <div><span><a href="/ads/library/?id=5555555555">First details</a></span>
          <p>First nested creative</p></div>
        </article>
        <article data-ad-preview="true">
          <div><a href="/ads/library/?id=6666666666">Second details</a>
          <p>Second nested creative</p></div>
        </article>
      </main>
    `);

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      libraryId: "5555555555",
      body: expect.stringContaining("First nested creative"),
    });
    expect(result.cards[0].body).not.toContain("Second nested creative");
    expect(result.cards[1]).toMatchObject({
      libraryId: "6666666666",
      body: expect.stringContaining("Second nested creative"),
    });
  });

  it("keeps a destination-only rendered card out of hook and offer evidence", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );
    const { normalizeExtractedCard } = await import(
      "~/lib/meta-library-browser.server"
    );
    const parsed = parseRenderedMetaLibraryHtml(`
      <article role="article">
        <strong>Example Brand</strong>
        <span>Sponsored</span>
        <span>COD.COM</span>
        <button>Shop now</button>
        <a href="/ads/library/?id=9999999999">View ad details</a>
      </article>
    `);

    expect(parsed.cards).toHaveLength(1);
    const ad = normalizeExtractedCard(parsed.cards[0]!, buildQuery());
    expect(ad.landingPageUrl).toBe("https://cod.com/");
    expect(ad.body).toBe("");
    expect(ad.hook).toBe("");
    expect(ad.offer).toBe("");
    expect(ad.analysisFields.map((field) => field.fieldKey)).not.toEqual(
      expect.arrayContaining(["hook", "offer"]),
    );
  });

  it("falls back to adjacent anchor blocks when rendered markup is unclosed", async () => {
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const result = parseRenderedMetaLibraryHtml(`
      <div data-ad-preview="true"><section>
        <a href="/ads/library/?id=7777777777">First details</a>
        <strong>First malformed creative</strong>
      <div data-ad-preview="true"><section>
        <a href="/ads/library/?id=8888888888">Second details</a>
        <strong>Second malformed creative</strong>
    `);

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      libraryId: "7777777777",
      body: expect.stringContaining("First malformed creative"),
    });
    expect(result.cards[0].body).not.toContain("Second malformed creative");
    expect(result.cards[1]).toMatchObject({
      libraryId: "8888888888",
      body: expect.stringContaining("Second malformed creative"),
    });
  });

  it("selects the smallest nested rendered card boundary for each ad anchor", async () => {
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const result = parseRenderedMetaLibraryHtml(`
      <main>
        <article role="article">
          <div><span><a href="/ads/library/?id=5555555555">First details</a></span>
          <p>First nested creative</p></div>
        </article>
        <article data-ad-preview="true">
          <div><a href="/ads/library/?id=6666666666">Second details</a>
          <p>Second nested creative</p></div>
        </article>
      </main>
    `);

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      libraryId: "5555555555",
      body: expect.stringContaining("First nested creative"),
    });
    expect(result.cards[0].body).not.toContain("Second nested creative");
    expect(result.cards[1]).toMatchObject({
      libraryId: "6666666666",
      body: expect.stringContaining("Second nested creative"),
    });
  });

  it("falls back to adjacent anchor blocks when rendered markup is unclosed", async () => {
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const result = parseRenderedMetaLibraryHtml(`
      <div data-ad-preview="true"><section>
        <a href="/ads/library/?id=7777777777">First details</a>
        <strong>First malformed creative</strong>
      <div data-ad-preview="true"><section>
        <a href="/ads/library/?id=8888888888">Second details</a>
        <strong>Second malformed creative</strong>
    `);

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({
      libraryId: "7777777777",
      body: expect.stringContaining("First malformed creative"),
    });
    expect(result.cards[0].body).not.toContain("Second malformed creative");
    expect(result.cards[1]).toMatchObject({
      libraryId: "8888888888",
      body: expect.stringContaining("Second malformed creative"),
    });
  });

  it("classifies Browserless fetch aborts as timeouts", async () => {
    mockFetchWithDns(
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }) as never,
    );
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSERLESS_TOKEN: "browserless-token",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "timeout",
    });
  });

  it("classifies unreadable Browserless response bodies as timeouts", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("deadline", "AbortError"));
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSERLESS_TOKEN: "browserless-token",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "timeout",
    });
  });

  it("treats an explicit Browserless no-results page as a healthy empty Meta result", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <main>
                        <h1>No results</h1>
                        <p>We couldn't find any ads.</p>
                      </main>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
      ads: [],
    });
  });

  it("treats a Quick Actions no-results payload as healthy instead of scraping fallback", async () => {
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent({ cards: [], noResults: true }),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1000",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(1);
    expect(result.ads).toEqual([]);
    expect(result.discoveryEmptyReason).toBe("no_results");
  });

  it("retries a transient empty Browserless render before failing the Meta capture", async () => {
    const browserlessResponses = [
      new Response(
        JSON.stringify({
          data: {
            html: {
              html: "<html><body>No ad cards rendered yet</body></html>",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
      new Response(
        JSON.stringify({
          data: {
            html: {
              html: `
                <html>
                  <body>
                    <article>
                      <strong>Nykaa</strong>
                      <span>Sponsored</span>
                      <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                      <a href="/ads/library/?id=1234567890">View ad details</a>
                      <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                    </article>
                  </body>
                </html>
              `,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    ];
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () => browserlessResponses.shift() ?? new Response(null, { status: 500 })) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(2);
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "Nykaa",
      }),
    ]);
  });

  it("extracts rendered Meta Ad Library text cards when ad-detail links are absent", async () => {
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <main>
                        ~6,200 results
                        Active
                        Library ID: 1280520150312258
                        Started running on 14 Jul 2025
                        Platforms
                        This ad has multiple versions
                        Menu
                        See ad details
                        Nykaa Man
                        Sponsored
                        For the Man Who Never Settles For Less
                        Flat ₹400 Off on Your First Order
                        For the Man Who Never Settles For Less
                        Flat ₹400 Off on Your First Order
                        NYKAAMAN.COM
                        Shop Now
                      </main>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      ads: [
        expect.objectContaining({
          metaAdId: "1280520150312258",
          advertiser: "Nykaa Man",
          body:
            "For the Man Who Never Settles For Less\nFlat ₹400 Off on Your First Order",
          previewHeadline: "For the Man Who Never Settles For Less",
          cta: "Shop Now",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1280520150312258",
          landingPageUrl: "https://nykaaman.com/",
          active: true,
					// Meta's published "Started running on" line becomes firstSeenAt…
					firstSeenAt: "2025-07-14",
          source: "meta_library_browser",
        }),
      ],
    });
		// …while staying excluded from the ad body as UI noise.
		expect(result.ads[0].body).not.toMatch(/started running/i);
	});

	it("keeps firstSeenAt null when the started-running line is unparseable", async () => {
		mockFetchWithDns(
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						data: {
							html: {
                html: `
                  <html>
                    <body>
                      <main>
                        Active
                        Library ID: 1280520150312259
                        Started running on soon
                        See ad details
                        Nykaa Man
                        Sponsored
                        For the Man Who Never Settles For Less
                        NYKAAMAN.COM
                        Shop Now
                      </main>
                    </body>
                  </html>
                `,
							},
						},
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
			) as never,
		);

		const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

		const result = await searchMetaLibraryByBrowser(
			{
				BROWSERLESS_TOKEN: "browserless-token",
			},
			buildQuery(),
		);

		expect(result.ads).toEqual([
			expect.objectContaining({
				metaAdId: "1280520150312259",
				// honest null: an unreadable date is never guessed
				firstSeenAt: null,
			}),
		]);
		expect(result.ads[0].body).not.toMatch(/started running/i);
  });

  it("fails fast when Browser Run reports no new browser acquisitions are allowed", async () => {
    const launch = vi.fn();
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 0,
      timeUntilNextAllowedBrowserAcquisition: 15000,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
      message: "Browser Run rate limited this request. Retry after about 15s.",
      retryAfterSeconds: 15,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("classifies Browser Run 429 launch failures as rate limited", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
    });
  });

  it("fails honestly when a Browser Run session returns no extractable cards", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: false,
        rateLimited: false,
      });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "empty_result",
    });
  });

  it("falls back to rendered-text parsing when DOM discovery yields only content-free ghost cards", async () => {
    // Reproduces the logged-out Browser Rendering incident: the "Library ID: N"
    // label-climbing discovery emits cards that carry a library id but no
    // advertiser/body/creative (the climb stopped at the bare label on Meta's
    // flat/virtualized grid). Those non-empty-but-useless cards must not
    // short-circuit the hardened rendered-text fallback, which parses the ad
    // copy still present in the page's innerText.
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi.fn().mockResolvedValue({
      cards: [
        {
          libraryId: "1280520150312258",
          advertiser: "",
          body: "Library ID: 1280520150312258",
          previewHeadline: "",
          previewSubhead: null,
          cta: "",
          adSnapshotUrl:
            "https://www.facebook.com/ads/library/?id=1280520150312258",
          landingPageUrl: null,
          platforms: [],
          active: null,
          startedRunning: null,
          imageUrl: null,
          hasVideo: false,
          variantCount: null,
        },
      ],
      pageText: [
        "~6,200 results",
        "Active",
        "Library ID: 1280520150312258",
        "Started running on 14 Jul 2025",
        "Platforms",
        "Nykaa Man",
        "Sponsored",
        "For the Man Who Never Settles For Less",
        "Flat ₹400 Off on Your First Order",
        "NYKAAMAN.COM",
        "Shop Now",
      ].join("\n"),
      loginWall: false,
      noResults: false,
      rateLimited: false,
    });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import(
      "~/lib/meta-library-browser.server"
    );

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    // The result is the real ad recovered from rendered text, not the ghost card.
    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]).toMatchObject({
      metaAdId: "1280520150312258",
      advertiser: "Nykaa Man",
      cta: "Shop Now",
      source: "meta_library_browser",
    });
    expect(result.ads[0].body).toContain("Never Settles For Less");
    // The ghost card (empty advertiser + label-only body) must never surface.
    expect(result.ads[0].advertiser).not.toBe("");
  });

  it("drops content-free ghost cards even when no rendered-text ad is recoverable", async () => {
    const { adHasUsableContent } = await import(
      "~/lib/meta-library-browser.server"
    );
    expect(
      adHasUsableContent({
        advertiser: "",
        body: "",
        previewHeadline: "",
        creativeImageUrl: null,
      } as never),
    ).toBe(false);
    expect(
      adHasUsableContent({
        advertiser: "Nykaa Man",
        body: "",
        previewHeadline: "",
        creativeImageUrl: null,
      } as never),
    ).toBe(true);
    expect(
      adHasUsableContent({
        advertiser: "",
        body: "",
        previewHeadline: "",
        creativeImageUrl: "https://scontent.example/creative.jpg",
      } as never),
    ).toBe(true);
  });

  it("treats Browser Run no-results page text as a healthy empty Meta result", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi.fn(async (callback: () => unknown) => {
      vi.stubGlobal("document", {
        querySelectorAll: vi.fn().mockReturnValue([]),
        body: {
          innerText: "No results We couldn't find any ads.",
        },
      });

      return callback();
    });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      buildQuery(),
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryEmptyReason: "no_results",
      ads: [],
    });
  });

  it("falls back to Quick Actions when Browser Run session launch is rate limited", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(launch).toHaveBeenCalled();
    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      ads: [
        expect.objectContaining({
          metaAdId: "1234567890",
          advertiser: "Nykaa",
          source: "meta_library_browser",
        }),
      ],
    });
  });

  it("uses Browserless when Quick Actions time out after Browser Run session fallback", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        if (String(input).includes("/browser-rendering/content")) {
          throw new DOMException("aborted", "AbortError");
        }

        return new Response(
          JSON.stringify({
            data: {
              html: {
                html: `
                  <html>
                    <body>
                      <article>
                        <strong>Nykaa</strong>
                        <span>Sponsored</span>
                        <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                        <a href="/ads/library/?id=1234567890">View ad details</a>
                        <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                      </article>
                    </body>
                  </html>
                `,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
        BROWSERLESS_TOKEN: "browserless-token",
      },
      buildQuery(),
    );
    const liveFetches = nonDnsFetchCalls(fetch);

    // The Quick Action content call times out and is retried once (bounded
    // retry), then the pipeline falls through to the Browserless fallback.
    expect(String(liveFetches[0]?.[0])).toContain("/browser-rendering/content");
    expect(String(liveFetches[1]?.[0])).toContain("/browser-rendering/content");
    expect(String(liveFetches[2]?.[0])).toContain("/stealth/bql?token=browserless-token");
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        source: "meta_library_browser",
      }),
    ]);
  });

  it("falls back to Quick Actions when Browser Run session extraction is empty", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: false,
        rateLimited: false,
      });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result.ads).toHaveLength(1);
  });

  it("falls back to Quick Actions when Browser Run session hits a login wall", async () => {
    const { browser, page } = createBrowserHarness();
    page.evaluate = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        loginWall: true,
        rateLimited: false,
      });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(result.ads).toHaveLength(1);
  });

  it("uses Quick Actions directly when the browser binding is unavailable", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(nonDnsFetchCalls(fetch)).toHaveLength(1);
    expect(launch).not.toHaveBeenCalled();
    expect(result.ads).toHaveLength(1);
  });

	it("extracts Quick Actions dates across adjacent rendered card blocks", async () => {
		let extractionScript = "";
		const fetchSpy = mockFetchWithDns(
			vi.fn(async (_input, init) => {
				const requestBody = JSON.parse(String(init?.body ?? "{}"));
				extractionScript = requestBody.addScriptTag?.[0]?.content ?? "";
				return new Response(
					JSON.stringify({
						success: true,
						result: buildQuickActionContent(),
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"X-Browser-Ms-Used": "1234",
						},
					},
				);
			}) as never,
		);

		const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

		await searchMetaLibraryByBrowser(
			{
				BROWSER_RUN_ACCOUNT_ID: "acct-123",
				BROWSER_RUN_API_TOKEN: "token-123",
			},
			buildQuery(),
		);

		const window = new Window({ url: "https://www.facebook.com/ads/library/" });
		window.document.body.innerHTML =
			'<article><a href="/ads/library/?id=1234567890">View ad details</a><div>Active</div><div>Started running on 14 Jul 2025</div><div>Sponsored</div></article>';
		const card = window.document.querySelector("article");
		expect(card?.textContent).not.toContain("\n");
		expect(card?.innerText).toMatch(/\nStarted running on 14 Jul 2025/);

		window.eval(extractionScript);
		const payloadScript = window.document.getElementById("__0509_ad_library_payload");
		const payload = JSON.parse(payloadScript?.textContent ?? "{}");

		expect(payload.cards).toEqual([
			expect.objectContaining({
				libraryId: "1234567890",
				startedRunning: "Started running on 14 Jul 2025",
			}),
		]);
		expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(1);
	});

	it("picks the real CTA button over Ad Library chrome in the Quick Actions script", async () => {
		let extractionScript = "";
		const fetchSpy = mockFetchWithDns(
			vi.fn(async (_input, init) => {
				const requestBody = JSON.parse(String(init?.body ?? "{}"));
				extractionScript = requestBody.addScriptTag?.[0]?.content ?? "";
				return new Response(
					JSON.stringify({
						success: true,
						result: buildQuickActionContent(),
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"X-Browser-Ms-Used": "1234",
						},
					},
				);
			}) as never,
		);

		const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

		await searchMetaLibraryByBrowser(
			{
				BROWSER_RUN_ACCOUNT_ID: "acct-123",
				BROWSER_RUN_API_TOKEN: "token-123",
			},
			buildQuery(),
		);

		// Live 2026-08-09 Ad Library DOM shape: the card's first button-like
		// element is chrome (the overflow "Menu" button, then "See ad
		// details"); the advertiser's real CTA button comes later. The
		// extractor must skip chrome and pick the real CTA.
		const window = new Window({ url: "https://www.facebook.com/ads/library/" });
		window.document.body.innerHTML = `
			<article role="article">
				<div>Active</div>
				<div>Library ID: 1234567890</div>
				<div>Started running on 1 Jun 2026</div>
				<div>Platforms</div>
				<div>Sponsored</div>
				<p>Flat 30% off on serums</p>
				<div role="button" aria-label="Menu">Menu</div>
				<div role="button">See ad details</div>
				<div role="button">Sign up</div>
				<a href="/ads/library/?id=1234567890">View ad details</a>
			</article>
			<article role="article">
				<div>Active</div>
				<div>Library ID: 9999999999</div>
				<div>Sponsored</div>
				<p>Text-only card with no CTA button</p>
				<div role="button" aria-label="Menu">Menu</div>
				<div role="button">See ad details</div>
				<a href="/ads/library/?id=9999999999">View ad details</a>
			</article>
		`;

		window.eval(extractionScript);
		const payloadScript = window.document.getElementById("__0509_ad_library_payload");
		const payload = JSON.parse(payloadScript?.textContent ?? "{}") as {
			cards?: Array<{ libraryId: string; cta: string | null }>;
		};

		const byId = new Map(
			(payload.cards ?? []).map((card) => [card.libraryId, card] as const),
		);
		expect(byId.get("1234567890")?.cta).toBe("Sign up");
		// Chrome-only card: no CTA is honest; "Menu" must never render.
		expect(byId.get("9999999999")?.cta).toBe("");
		expect(nonDnsFetchCalls(fetchSpy)).toHaveLength(1);
	});

	it("skips Ad Library chrome buttons when the session extraction script picks the CTA", async () => {
		const { createSessionCardExtractionScript } = await import(
			"~/lib/meta-library-browser.server"
		);

		const window = new Window({ url: "https://www.facebook.com/ads/library/" });
		window.document.body.innerHTML = `
			<article role="article">
				<div>Active</div>
				<div>Library ID: 1234567890</div>
				<div>Started running on 1 Jun 2026</div>
				<div>Platforms</div>
				<div>Sponsored</div>
				<p>Flat 30% off on serums</p>
				<div role="button" aria-label="Menu">Menu</div>
				<div role="button">See ad details</div>
				<div role="button">Get offer</div>
				<a href="/ads/library/?id=1234567890">View ad details</a>
			</article>
		`;

		const result = window.eval(
			`(${createSessionCardExtractionScript().toString()})()`,
		) as { cards: Array<{ libraryId: string; cta: string | null }> };

		expect(result.cards[0]).toMatchObject({
			libraryId: "1234567890",
			cta: "Get offer",
		});
	});

  it("keeps the Quick Actions runner separate from the extraction payload", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: buildQuickActionContent({
              withRunnerScript: true,
            }),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );
    const requestBody = JSON.parse(String(nonDnsFetchCalls(fetchSpy)[0]?.[1]?.body ?? "{}"));

    expect(requestBody.addScriptTag[0]).toMatchObject({
      id: "__0509_ad_library_extractor",
      type: "application/javascript",
    });
    expect(requestBody.addScriptTag[0].id).not.toBe("__0509_ad_library_payload");
    expect(result.ads).toHaveLength(1);
  });

  it("falls back to rendered HTML links when Quick Actions payload script is missing", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: `
              <html>
                <body>
                  <article>
                    <strong>Nykaa</strong>
                    <span>Sponsored</span>
                    <strong>Glow without compromise</strong>
                    <p>Flat 30% off on serums. Instagram Facebook Shop now</p>
                    <a href="/ads/library/?id=1234567890">View ad details</a>
                    <a href="https://www.nykaa.com/glow-sale">Shop now</a>
                  </article>
                </body>
              </html>
            `,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "1234",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );

    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "Nykaa",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        landingPageUrl: "https://www.nykaa.com/glow-sale",
        platforms: expect.arrayContaining(["Instagram", "Facebook"]),
      }),
    ]);
  });

  it("falls back to native Quick Actions scrape when content script injection is blocked", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    const quickActionResponses = [
      new Response(
        JSON.stringify({
          success: true,
          result: "<html><body><main>No injected payload yet</main></body></html>",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1000",
          },
        },
      ),
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              selector: 'a[href*="/ads/library/?id="]',
              results: [
                {
                  attributes: [
                    {
                      name: "href",
                      value: "/ads/library/?id=1234567890",
                    },
                  ],
                  html: '<a href="/ads/library/?id=1234567890">Nykaa serum sale Shop now Instagram Facebook</a>',
                  text: "Nykaa serum sale Shop now Instagram Facebook",
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Browser-Ms-Used": "1000",
          },
        },
      ),
    ];
    const fetchSpy = mockFetchWithDns(
      vi.fn(async () => quickActionResponses.shift() ?? new Response(null, { status: 500 })) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      buildQuery(),
    );
    const pageFetches = nonDnsFetchCalls(fetchSpy);
    const scrapeRequest = JSON.parse(String(pageFetches[1]?.[1]?.body ?? "{}"));

    expect(String(pageFetches[1]?.[0])).toContain("/browser-rendering/scrape");
    expect(scrapeRequest.elements).toEqual([
      {
        selector: 'a[href*="/ads/library/?id="], a[href*="facebook.com/ads/library/?id="]',
      },
    ]);
    expect(result.ads).toEqual([
      expect.objectContaining({
        metaAdId: "1234567890",
        advertiser: "",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        platforms: expect.arrayContaining(["Instagram", "Facebook"]),
        source: "meta_library_browser",
      }),
    ]);
  });

  it("classifies Quick Actions 429 errors as rate limited", async () => {
    const launch = vi.fn();
    const sessions = vi.fn();
    const limits = vi.fn();
    const connect = vi.fn();
    mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Too many requests" }],
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "10",
            },
          },
        ),
      ) as never,
    );

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER_RUN_ACCOUNT_ID: "acct-123",
          BROWSER_RUN_API_TOKEN: "token-123",
        },
        buildQuery(),
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
      retryAfterSeconds: 10,
    });
  });

  it("maps creativeType and status into Ad Library URL params", async () => {
    const { buildSearchUrl } = await import("~/lib/meta-library-browser.server");
    const url = buildSearchUrl({
      mode: "advertiser",
      filters: {
        query: "nike.com",
        country: "United States",
        platform: "all",
        creativeType: "video",
        status: "active",
        firstSeenFrom: "",
        lastSeenFrom: "",
      },
    });
    expect(url).toContain("media_type=video");
    expect(url).toContain("active_status=active");
    expect(url).toContain("country=US");
  });

  it("extracts variant counts from creative reuse copy", async () => {
    const { extractVariantCountFromText, parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );
    expect(extractVariantCountFromText("12 ads use this creative and text")).toBe(12);
    const result = parseRenderedMetaLibraryHtml(`
      <article role="article">
        <a href="/ads/library/?id=7778889990">See ad details</a>
        <p>12 ads use this creative and text</p>
        <p>Sale ends soon</p>
      </article>
    `);
    expect(result.cards[0]?.variantCount).toBe(12);
  });

  it("dedupes extracted cards by libraryId across scroll passes", async () => {
    const { dedupeExtractedCardsByLibraryId } = await import(
      "~/lib/meta-library-browser.server"
    );

    const deduped = dedupeExtractedCardsByLibraryId([
      {
        libraryId: "111",
        advertiser: "A",
        body: "first",
        previewHeadline: "first",
        previewSubhead: null,
        cta: null,
        adSnapshotUrl: null,
        landingPageUrl: null,
        platforms: [],
        active: true,
      },
      {
        libraryId: "222",
        advertiser: "B",
        body: "second",
        previewHeadline: "second",
        previewSubhead: null,
        cta: null,
        adSnapshotUrl: null,
        landingPageUrl: null,
        platforms: [],
        active: true,
      },
      {
        libraryId: "111",
        advertiser: "A-dup",
        body: "duplicate from later scroll",
        previewHeadline: "dup",
        previewSubhead: null,
        cta: null,
        adSnapshotUrl: null,
        landingPageUrl: null,
        platforms: [],
        active: true,
      },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((card) => card.libraryId)).toEqual(["111", "222"]);
    expect(deduped[0]?.body).toBe("first");
  });

  it("defaults browser discovery to shallow mode (no interactive scroll)", async () => {
    const { browser, page } = createBrowserHarness();
    const evaluate = page.evaluate as ReturnType<typeof vi.fn>;
    evaluate.mockResolvedValue({
      cards: [
        {
          libraryId: "1234567890",
          advertiser: "Nykaa",
          body: "Flat 30% off on serums",
          previewHeadline: "Glow sale",
          previewSubhead: "Weekend only",
          cta: "Shop now",
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1234567890",
          landingPageUrl: "https://www.nykaa.com/glow-sale",
          platforms: ["Instagram", "Facebook"],
          active: true,
        },
      ],
      pageText: "results",
      loginWall: false,
      noResults: false,
      rateLimited: false,
    });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");
    await searchMetaLibraryByBrowser({ BROWSER: {} as Fetcher }, buildQuery());

    // Shallow default: one extraction evaluate, no scroll evaluate.
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("interactive mode scrolls and re-extracts, deduping repeated library ids", async () => {
    const { browser, page } = createBrowserHarness();
    const evaluate = page.evaluate as ReturnType<typeof vi.fn>;
    const card = (id: string, body: string) => ({
      libraryId: id,
      advertiser: "Nike",
      body,
      previewHeadline: body,
      previewSubhead: null,
      cta: "Shop",
      adSnapshotUrl: `https://www.facebook.com/ads/library/?id=${id}`,
      landingPageUrl: null,
      platforms: ["Facebook"],
      active: true,
    });
    evaluate.mockImplementation(async (fn: unknown) => {
      // scrollTo path is a short function whose string form includes scrollTo
      if (typeof fn === "function" && String(fn).includes("scrollTo")) {
        return undefined;
      }
      // first real extraction has only one card; later re-extracts add a second
      if (evaluate.mock.calls.filter((call) => {
        const arg = call[0];
        return typeof arg === "function" && !String(arg).includes("scrollTo");
      }).length <= 1) {
        return {
          cards: [card("100", "Run")],
          pageText: "results",
          loginWall: false,
          noResults: false,
          rateLimited: false,
        };
      }
      return {
        cards: [card("100", "Run"), card("200", "Jump")],
        pageText: "results",
        loginWall: false,
        noResults: false,
        rateLimited: false,
      };
    });
    const launch = vi.fn().mockResolvedValue(browser);
    const sessions = vi.fn().mockResolvedValue([]);
    const limits = vi.fn().mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 2,
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
    });
    const connect = vi.fn();

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch, sessions, limits, connect },
    }));

    vi.useFakeTimers();
    try {
      const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");
      const resultPromise = searchMetaLibraryByBrowser(
        { BROWSER: {} as Fetcher },
        buildQuery(),
        { mode: "interactive" },
      );
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ads.map((ad) => ad.metaAdId)).toEqual(["100", "200"]);
      // first extract + scroll/re-extract cycles
      expect(evaluate.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps extracted card imageUrl onto AdRecord.creativeImageUrl", async () => {
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const ad = normalizeExtractedCard(
      {
        libraryId: "9990001111",
        advertiser: "Glossier",
        body: "New Balm Dotcom shades",
        previewHeadline: "Shop the drop",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=9990001111",
        landingPageUrl: "https://www.glossier.com",
        platforms: ["Instagram"],
        active: true,
        imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/creative.jpg",
        hasVideo: false,
      },
      buildQuery(),
    );

    expect(ad.creativeImageUrl).toBe(
      "https://scontent.xx.fbcdn.net/v/t39.35426-6/creative.jpg",
    );
    expect(ad.creativeFormatHint).toBe("image");
    expect(ad.format).toBe("image");
  });

  it("strips Ad Library chrome lines before hook derivation (FIX-13)", async () => {
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");
    const chromeBody = [
      "Active",
      "Library ID: 123",
      "Started running on Jul 1, 2026",
      "Real ad copy here",
    ].join("\n");

    const ad = normalizeExtractedCard(
      {
        libraryId: "123",
        advertiser: "Nykaa",
        body: chromeBody,
        previewHeadline: "Active",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=123",
        landingPageUrl: "https://www.nykaa.com",
        platforms: ["Facebook"],
        active: true,
        imageUrl: null,
        hasVideo: false,
      },
      buildQuery(),
    );

    expect(ad.hook.toLowerCase()).toContain("real ad copy");
    expect(ad.hook.toLowerCase()).not.toContain("active");
    expect(ad.hook.toLowerCase()).not.toContain("library id");
  });

  it("drops Ad Library chrome captured as the CTA (FIX-14)", async () => {
    const { normalizeExtractedCard } = await import(
      "~/lib/meta-library-browser.server"
    );

    for (const chromeCta of ["Menu", "Open Drop-down", "See ad details", "View ad details"]) {
      const ad = normalizeExtractedCard(
        {
          libraryId: "123",
          advertiser: "Nykaa",
          body: "Real ad copy here",
          previewHeadline: "Real headline",
          previewSubhead: null,
          cta: chromeCta,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=123",
          landingPageUrl: "https://www.nykaa.com",
          platforms: ["Facebook"],
          active: true,
          imageUrl: null,
          hasVideo: false,
        },
        buildQuery(),
      );

      expect(ad.cta).toBe("");
    }
  });

  it("keeps a real advertiser CTA through normalization", async () => {
    const { normalizeExtractedCard } = await import(
      "~/lib/meta-library-browser.server"
    );

    for (const realCta of ["Sign up", "Shop now", "Get offer", "Learn more"]) {
      const ad = normalizeExtractedCard(
        {
          libraryId: "123",
          advertiser: "Nykaa",
          body: "Real ad copy here",
          previewHeadline: "Real headline",
          previewSubhead: null,
          cta: realCta,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=123",
          landingPageUrl: "https://www.nykaa.com",
          platforms: ["Facebook"],
          active: true,
          imageUrl: null,
          hasVideo: false,
        },
        buildQuery(),
      );

      expect(ad.cta).toBe(realCta);
    }
  });

  it("sets video format hint when the extracted card has a video surface", async () => {
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const ad = normalizeExtractedCard(
      {
        libraryId: "9990002222",
        advertiser: "Nike",
        body: "Run free",
        previewHeadline: "Just Do It",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=9990002222",
        landingPageUrl: "https://www.nike.com",
        platforms: ["Facebook"],
        active: true,
        imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/poster.jpg",
        hasVideo: true,
      },
      buildQuery(),
    );

    expect(ad.creativeImageUrl).toContain("poster.jpg");
    expect(ad.creativeFormatHint).toBe("video");
    expect(ad.format).toBe("video");
  });

  it("extracts creative CDN images from rendered card HTML", async () => {
    const { parseRenderedMetaLibraryHtml, extractCreativeMediaFromHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const media = extractCreativeMediaFromHtml(`
      <div>
        <img src="https://static.xx.fbcdn.net/rsrc.php/profile-40.png" width="40" height="40" />
        <img src="https://scontent.xx.fbcdn.net/v/t39.35426-6/ad-creative.jpg" width="320" height="400" />
      </div>
    `);
    expect(media.imageUrl).toContain("ad-creative.jpg");
    expect(media.hasVideo).toBe(false);

    const videoMedia = extractCreativeMediaFromHtml(`
      <video poster="https://scontent.xx.fbcdn.net/v/t39.35426-6/poster.jpg"></video>
    `);
    expect(videoMedia.imageUrl).toContain("poster.jpg");
    expect(videoMedia.hasVideo).toBe(true);

    const result = parseRenderedMetaLibraryHtml(`
      <article role="article">
        <img src="https://scontent.xx.fbcdn.net/v/t39.35426-6/library-card.jpg" width="300" height="300" />
        <a href="/ads/library/?id=5551002003">See ad details</a>
        <p>Flat 20% off serums</p>
      </article>
    `);

    expect(result.cards[0]).toMatchObject({
      libraryId: "5551002003",
      imageUrl: expect.stringContaining("library-card.jpg"),
      hasVideo: false,
    });
  });

  it("leaves creativeImageUrl empty when no CDN image is present", async () => {
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const ad = normalizeExtractedCard(
      {
        libraryId: "9990003333",
        advertiser: "Unknown",
        body: "No creative on this card",
        previewHeadline: "Text only",
        previewSubhead: null,
        cta: null,
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=9990003333",
        landingPageUrl: null,
        platforms: [],
        active: true,
      },
      buildQuery(),
    );

    expect(ad.creativeImageUrl).toBeNull();
    expect(ad.creativeFormatHint).toBeUndefined();
  });
});

describe("Ad Library page-chrome truncation", () => {
  it("truncates run-on footer chrome absorbed by the last card", async () => {
    const { truncateAtAdLibraryPageChrome } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const polluted =
      "Shop our top must-haves now. Shop Now See more System status Ad Library APIAbout ads and data usePrivacyTermsCookies Meta © 2026 | English (US)";
    expect(truncateAtAdLibraryPageChrome(polluted)).toBe(
      "Shop our top must-haves now. Shop Now",
    );
  });

  it("leaves clean ad copy untouched", async () => {
    const { truncateAtAdLibraryPageChrome } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const clean = "Build your own set with the pieces you love most.";
    expect(truncateAtAdLibraryPageChrome(clean)).toBe(clean);
  });

  it("strips footer chrome before hook derivation via stripAdLibraryUiChromeFromBody", async () => {
    const { stripAdLibraryUiChromeFromBody } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const body =
      "Active\nLibrary ID: 123456\nReal ad copy here. Shop Now See more System status Ad Library API";
    const stripped = stripAdLibraryUiChromeFromBody(body);
    expect(stripped).toContain("Real ad copy here");
    expect(stripped).not.toContain("Library ID");
    expect(stripped).not.toContain("System status");
  });
});

describe("Ad Library chrome CTA guard", () => {
  it("flags chrome-only CTA values that must never render as the ad CTA", async () => {
    const { isAdLibraryChromeCta } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    for (const chrome of [
      "Menu",
      "menu",
      "Open Drop-down",
      "See ad details",
      "See summary details",
      "View ad details",
      "Meta Ad Library result",
      "More",
      "Report ad",
      " Menu ",
    ]) {
      expect(isAdLibraryChromeCta(chrome)).toBe(true);
    }
  });

  it("flags Menu with a trailing zero-width space (U+200B) as chrome", async () => {
    const { isAdLibraryChromeCta } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    // Exact production value captured from public search: the library
    // "Menu" overflow label plus newline plus U+200B. U+200B is not \s,
    // so the pre-fix normalizer left it in and the guard missed it.
    expect(isAdLibraryChromeCta("Menu\n\u200B")).toBe(true);
    expect(isAdLibraryChromeCta("Menu\u200B")).toBe(true);
  });

  it("never flags real advertiser CTAs", async () => {
    const { isAdLibraryChromeCta } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    for (const realCta of [
      "Shop now",
      "Learn more",
      "Sign up",
      "Apply now",
      "Book now",
      "Contact us",
      "Get offer",
      "Buy now",
      "Start free trial",
      "Book demo",
      "Order today",
    ]) {
      expect(isAdLibraryChromeCta(realCta)).toBe(false);
    }

    expect(isAdLibraryChromeCta(null)).toBe(false);
    expect(isAdLibraryChromeCta("")).toBe(false);
    expect(isAdLibraryChromeCta(undefined)).toBe(false);
  });
});

describe("session extraction card mapping", () => {
  it("passes variantCount through normalizeExtractedCard", async () => {
    const { normalizeExtractedCard } = await import("~/lib/meta-library-browser.server");

    const ad = normalizeExtractedCard(
      {
        libraryId: "7770001111",
        advertiser: "Glossier",
        body: "Smells different on everyone.\n2 ads use this creative and text",
        previewHeadline: "Glossier You",
        previewSubhead: null,
        cta: "Shop Now",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=7770001111",
        landingPageUrl: "https://www.glossier.com/products/glossier-you",
        platforms: ["Instagram"],
        active: true,
        variantCount: 2,
      },
      buildQuery(),
    );

    expect(ad.variantCount).toBe(2);
  });
});

describe("page-id-aware discovery", () => {
  it("scopes the Ad Library URL to view_all_page_id when a verified page id is set", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { buildSearchUrl } = await import("~/lib/meta-library-browser.server");

    const url = new URL(
      buildSearchUrl({
        mode: "advertiser",
        filters: {
          ...buildQuery().filters,
          query: "nike",
          country: "United States",
          status: "active",
          pageId: "15087023444",
        },
      }),
    );

    // The keyword guess is dropped entirely in favor of exact page scoping.
    expect(url.searchParams.get("view_all_page_id")).toBe("15087023444");
    expect(url.searchParams.get("search_type")).toBe("page");
    expect(url.searchParams.get("q")).toBeNull();
    // Country/status/media filters still ride along on the scoped scan.
    expect(url.searchParams.get("country")).toBe("US");
    expect(url.searchParams.get("active_status")).toBe("active");
  });

  it("stays a keyword search and ignores a non-numeric page id", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { buildSearchUrl } = await import("~/lib/meta-library-browser.server");

    const url = new URL(
      buildSearchUrl({
        mode: "keyword",
        filters: {
          ...buildQuery().filters,
          query: "nike",
          // A spoofed non-numeric value must never scope a scan.
          pageId: "nike; DROP",
        },
      }),
    );

    expect(url.searchParams.get("view_all_page_id")).toBeNull();
    expect(url.searchParams.get("q")).toBe("nike");
    expect(url.searchParams.get("search_type")).toBe("keyword_unordered");
  });

  it("floats brand-name advertiser matches above unrelated advertisers", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { rankExtractedCardsByAdvertiserMatch } = await import(
      "~/lib/meta-library-browser.server"
    );
    const card = (libraryId: string, advertiser: string) => ({
      libraryId,
      advertiser,
      body: "",
      previewHeadline: "",
      previewSubhead: null,
      cta: "",
      adSnapshotUrl: null,
      landingPageUrl: null,
      platforms: [],
      active: true,
    });
    const cards = [
      card("1", "Whatnot"),
      card("2", "Nike"),
      card("3", "Amazon.com"),
      card("4", "Nike, Inc."),
    ];

    const ranked = rankExtractedCardsByAdvertiserMatch(cards, {
      mode: "keyword",
      filters: { ...buildQuery().filters, query: "nike" },
    });

    // Nike advertisers first (stable order preserved), resellers after.
    expect(ranked.map((entry) => entry.libraryId)).toEqual(["2", "4", "1", "3"]);
  });

  it("does not reorder cards once the scan is already page-scoped", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { rankExtractedCardsByAdvertiserMatch } = await import(
      "~/lib/meta-library-browser.server"
    );
    const cards = [
      { libraryId: "1", advertiser: "Whatnot" },
      { libraryId: "2", advertiser: "Nike" },
    ].map((partial) => ({
      ...partial,
      body: "",
      previewHeadline: "",
      previewSubhead: null,
      cta: "",
      adSnapshotUrl: null,
      landingPageUrl: null,
      platforms: [],
      active: true,
    }));

    const ranked = rankExtractedCardsByAdvertiserMatch(cards, {
      mode: "advertiser",
      filters: { ...buildQuery().filters, query: "nike", pageId: "15087023444" },
    });

    expect(ranked.map((entry) => entry.libraryId)).toEqual(["1", "2"]);
  });

  it("carries the scraped advertiser page id onto the normalized ad record", async () => {
    vi.doMock("@cloudflare/puppeteer", () => ({ default: {} }));
    const { normalizeExtractedCard } = await import(
      "~/lib/meta-library-browser.server"
    );

    const ad = normalizeExtractedCard(
      {
        libraryId: "1869276447125570",
        advertiser: "Nike",
        body: "Celebrate with Nike",
        previewHeadline: "Nike",
        previewSubhead: null,
        cta: "Shop now",
        adSnapshotUrl:
          "https://www.facebook.com/ads/library/?id=1869276447125570",
        landingPageUrl: "https://www.nike.com/",
        platforms: ["Instagram"],
        active: true,
        pageId: "15087023444",
      },
      buildQuery(),
    );

    expect(ad.advertiserPageId).toBe("15087023444");
  });
});

describe("Ad Library relay page-identity parsing", () => {
  it("maps ad_archive_id to the advertiser numeric page id from the relay payload", async () => {
    const { extractAdArchivePageIdentities } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );
    // Shape mirrors the live Ad Library relay payload (collated_results node).
    const relay = `{"collated_results":[{"ad_archive_id":"1869276447125570","is_active":true,"page_id":"15087023444","page_is_deleted":false,"snapshot":{"page_id":"15087023444","page_name":"Nike"}},{"ad_archive_id":"1033781512449452","page_id":"721404351056614","page_name":"IControl: Easy Widgets Themes"}]}`;

    const identities = extractAdArchivePageIdentities(relay);

    expect(identities.get("1869276447125570")).toEqual({
      pageId: "15087023444",
      pageName: "Nike",
    });
    expect(identities.get("1033781512449452")?.pageId).toBe("721404351056614");
  });

  it("resolves escaped-quote relay nodes even when nodes are far apart", async () => {
    const { extractAdArchivePageIdentities } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );
    // Mirrors the LIVE payload: Relay JSON embedded as a string (escaped
    // quotes), page_id ~90 chars after ad_archive_id, and a large gap of
    // unrelated snapshot fields before the next node. The earlier lookahead
    // implementation discarded every match here; the windowed one must not.
    const filler = "\\\"snapshot\\\":{" + "\\\"x\\\":1,".repeat(400) + "}";
    const relay =
      `[{\\"ad_archive_id\\":\\"1869276447125570\\",\\"collation_count\\":null,\\"is_active\\":true,\\"page_id\\":\\"15087023444\\",${filler}},` +
      `{\\"ad_archive_id\\":\\"1502078871070045\\",\\"page_id\\":\\"112727500143177\\",\\"page_name\\":\\"Whatnot\\"}]`;

    const identities = extractAdArchivePageIdentities(relay);

    expect(identities.get("1869276447125570")?.pageId).toBe("15087023444");
    expect(identities.get("1502078871070045")?.pageId).toBe("112727500143177");
  });

  it("reads a numeric advertiser-page link but returns null for a vanity link", async () => {
    const { numericPageIdFromFacebookProfileHref } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    expect(
      numericPageIdFromFacebookProfileHref(
        "https://www.facebook.com/61578892468353/",
      ),
    ).toBe("61578892468353");
    expect(
      numericPageIdFromFacebookProfileHref("https://www.facebook.com/nike/"),
    ).toBeNull();
    expect(
      numericPageIdFromFacebookProfileHref("https://evil.example/12345/"),
    ).toBeNull();
  });

  it("attaches the relay page id to rendered cards by library id", async () => {
    const { parseRenderedMetaLibraryHtml } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );

    const result = parseRenderedMetaLibraryHtml(`
      <script>{"ad_archive_id":"5555555555","page_id":"15087023444","page_name":"Nike"}</script>
      <article role="article">
        <strong>Nike</strong>
        <span>Sponsored</span>
        <a href="/ads/library/?id=5555555555">View ad details</a>
      </article>
    `);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].pageId).toBe("15087023444");
  });

  it("fills an empty DOM advertiser from Relay page_name (live search regression)", async () => {
    // Live 2026-08-07: every public search card had advertiserPageId but
    // empty advertiser ("Advertiser unconfirmed"). The capture path must
    // promote Relay page_name into advertiser when the card DOM has no
    // strong/h3 name — never invent a name from the search query.
    const {
      applyRelayPageIdentitiesToCards,
      extractAdArchivePageIdentities,
      parseRenderedMetaLibraryHtml,
    } = await import("~/lib/meta-library-rendered-card-parser.server");
    const { normalizeExtractedCard } = await import(
      "~/lib/meta-library-browser.server"
    );

    const html = `
      <script>
        {"ad_archive_id":"1111111111","is_active":true,"page_id":"872580559271410","page_is_deleted":false,"snapshot":{"page_id":"872580559271410","page_name":"Ktein","body":{"text":"Say Goodbye to Bad Hair Days!"}}}
        {"ad_archive_id":"2222222222","page_id":"589349284560350","snapshot":{"page_name":"Coloressence"}}
      </script>
      <article role="article">
        <div>Active</div>
        <div>Library ID: 1111111111</div>
        <div>Sponsored</div>
        <p>Say Goodbye to Bad Hair Days!</p>
        <a href="/ads/library/?id=1111111111">View ad details</a>
      </article>
      <article role="article">
        <div>Active</div>
        <div>Library ID: 2222222222</div>
        <div>Sponsored</div>
        <p>Get your favorite makeup essentials</p>
        <a href="/ads/library/?id=2222222222">View ad details</a>
      </article>
    `;

    const parsed = parseRenderedMetaLibraryHtml(html);
    expect(parsed.cards.length).toBeGreaterThanOrEqual(1);

    const byId = new Map(parsed.cards.map((card) => [card.libraryId, card]));
    expect(byId.get("1111111111")?.advertiser).toBe("Ktein");
    expect(byId.get("1111111111")?.pageId).toBe("872580559271410");
    expect(byId.get("2222222222")?.advertiser).toBe("Coloressence");
    expect(byId.get("2222222222")?.pageId).toBe("589349284560350");

    // Session-path shape: DOM cards with empty advertiser + pageId only,
    // then server merge from the same HTML (what mergeRelayIdentitiesFromPage does).
    const identities = extractAdArchivePageIdentities(html);
    const sessionShaped = applyRelayPageIdentitiesToCards(
      [
        {
          libraryId: "1111111111",
          advertiser: "",
          body: "Say Goodbye to Bad Hair Days!",
          previewHeadline: "Say Goodbye to Bad Hair Days!",
          previewSubhead: null,
          cta: null,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1111111111",
          landingPageUrl: "https://www.nykaa.com/brands/ktein",
          platforms: ["Instagram"],
          active: true,
          pageId: "872580559271410",
        },
        {
          libraryId: "2222222222",
          advertiser: null,
          body: "Get your favorite makeup essentials",
          previewHeadline: null,
          previewSubhead: null,
          cta: null,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=2222222222",
          landingPageUrl: null,
          platforms: [],
          active: true,
          pageId: "589349284560350",
        },
      ],
      identities,
    );

    expect(sessionShaped[0]?.advertiser).toBe("Ktein");
    expect(sessionShaped[1]?.advertiser).toBe("Coloressence");

    const ad = normalizeExtractedCard(sessionShaped[0]!, buildQuery());
    expect(ad.advertiser).toBe("Ktein");
    expect(ad.advertiserPageId).toBe("872580559271410");
    expect(ad.previewHeadline).toMatch(/Say Goodbye to Bad Hair Days/i);
  });

  it("does not invent an advertiser from the search query when Relay has no page_name", async () => {
    const { applyRelayPageIdentitiesToCards, extractAdArchivePageIdentities } =
      await import("~/lib/meta-library-rendered-card-parser.server");

    const identities = extractAdArchivePageIdentities(
      `{"ad_archive_id":"9999999999","page_id":"111222333444555"}`,
    );
    const merged = applyRelayPageIdentitiesToCards(
      [
        {
          libraryId: "9999999999",
          advertiser: "",
          body: "Some ad copy",
          previewHeadline: null,
          previewSubhead: null,
          cta: null,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=9999999999",
          landingPageUrl: null,
          platforms: [],
          active: true,
          pageId: "111222333444555",
        },
      ],
      identities,
    );

    expect(merged[0]?.pageId).toBe("111222333444555");
    // Honest gap: still empty — display layer keeps "Advertiser unconfirmed".
    expect(merged[0]?.advertiser).toBeNull();
  });

  it("keeps a DOM-scraped advertiser over Relay page_name", async () => {
    const { applyRelayPageIdentitiesToCards, extractAdArchivePageIdentities } =
      await import("~/lib/meta-library-rendered-card-parser.server");

    const identities = extractAdArchivePageIdentities(
      `{"ad_archive_id":"3333333333","page_id":"15087023444","page_name":"Nike Official"}`,
    );
    const merged = applyRelayPageIdentitiesToCards(
      [
        {
          libraryId: "3333333333",
          advertiser: "Nike",
          body: "Just do it",
          previewHeadline: null,
          previewSubhead: null,
          cta: null,
          adSnapshotUrl: "https://www.facebook.com/ads/library/?id=3333333333",
          landingPageUrl: null,
          platforms: [],
          active: true,
          pageId: null,
        },
      ],
      identities,
    );

    expect(merged[0]?.advertiser).toBe("Nike");
    expect(merged[0]?.pageId).toBe("15087023444");
  });

  it("reads page_name nested deep in snapshot beyond the old 800-char window", async () => {
    const { extractAdArchivePageIdentities } = await import(
      "~/lib/meta-library-rendered-card-parser.server"
    );
    // page_id early, then ~2k of snapshot filler, then page_name — the old
    // 800-char cap captured page_id and dropped the name on live payloads.
    const filler = `"x":"${"a".repeat(2000)}"`;
    const relay = `{"ad_archive_id":"4444444444","page_id":"15087023444","snapshot":{${filler},"page_name":"Nykaa"}}`;

    const identities = extractAdArchivePageIdentities(relay);

    expect(identities.get("4444444444")).toEqual({
      pageId: "15087023444",
      pageName: "Nykaa",
    });
  });
});

describe("Browser Run Quick Action capture retries", () => {
  it("retries a transient 429 once (honoring Retry-After) and succeeds on the retry", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async (input) => {
        if (!String(input).includes("/browser-rendering/content")) {
          throw new Error("unexpected endpoint");
        }
        if (fetch.mock.calls.filter(([call]) => String(call).includes("/browser-rendering/content")).length === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              errors: [{ message: "Too many requests" }],
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "1",
              },
            },
          );
        }
        return new Response(
          JSON.stringify({ success: true, result: "captured content" }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Browser-Ms-Used": "123",
            },
          },
        );
      }) as never,
    );

    const { captureBrowserRunQuickActionContent } = await import("~/lib/browser-run.server");
    const result = await captureBrowserRunQuickActionContent(
      {
        BROWSER_RUN_ACCOUNT_ID: "acct-123",
        BROWSER_RUN_API_TOKEN: "token-123",
      },
      { url: "https://example.com/glow" },
    );

    const contentFetches = nonDnsFetchCalls(fetch).filter(([input]) =>
      String(input).includes("/browser-rendering/content"),
    );
    expect(contentFetches).toHaveLength(2);
    expect(result).toEqual({
      browserMsUsed: 123,
      content: "captured content",
    });
  });

  it("keeps the final 429 error with its Retry-After when both attempts are rate limited", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Too many requests" }],
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "10",
            },
          },
        ),
      ) as never,
    );

    const { captureBrowserRunQuickActionContent, BrowserRunQuickActionError } = await import(
      "~/lib/browser-run.server"
    );

    await expect(
      captureBrowserRunQuickActionContent(
        {
          BROWSER_RUN_ACCOUNT_ID: "acct-123",
          BROWSER_RUN_API_TOKEN: "token-123",
        },
        { url: "https://example.com/glow" },
      ),
    ).rejects.toBeInstanceOf(BrowserRunQuickActionError);
    const contentFetches = nonDnsFetchCalls(fetch).filter(([input]) =>
      String(input).includes("/browser-rendering/content"),
    );
    expect(contentFetches).toHaveLength(2);
    try {
      await captureBrowserRunQuickActionContent(
        {
          BROWSER_RUN_ACCOUNT_ID: "acct-123",
          BROWSER_RUN_API_TOKEN: "token-123",
        },
        { url: "https://example.com/glow" },
      );
      throw new Error("expected the second call to reject");
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        retryAfterSeconds: 10,
      });
    }
  });

  it("does not retry a permanent 4xx failure", async () => {
    const fetch = mockFetchWithDns(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Not authorized" }],
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      ) as never,
    );

    const { captureBrowserRunQuickActionContent, BrowserRunQuickActionError } = await import(
      "~/lib/browser-run.server"
    );

    await expect(
      captureBrowserRunQuickActionContent(
        {
          BROWSER_RUN_ACCOUNT_ID: "acct-123",
          BROWSER_RUN_API_TOKEN: "token-123",
        },
        { url: "https://example.com/glow" },
      ),
    ).rejects.toBeInstanceOf(BrowserRunQuickActionError);
    const contentFetches = nonDnsFetchCalls(fetch).filter(([input]) =>
      String(input).includes("/browser-rendering/content"),
    );
    expect(contentFetches).toHaveLength(1);
  });
});
