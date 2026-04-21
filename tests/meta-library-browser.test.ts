import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("searchMetaLibraryByBrowser", () => {
  it("uses Browser Run to normalize public Ad Library results into 0509 search records", async () => {
    const page = {
      goto: vi.fn(),
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      evaluate: vi.fn().mockResolvedValue([
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
      ]),
      url: vi
        .fn()
        .mockReturnValue("https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&q=nykaa"),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const launch = vi.fn().mockResolvedValue(browser);

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch },
    }));

    const { searchMetaLibraryByBrowser } = await import("~/lib/meta-library-browser.server");

    const result = await searchMetaLibraryByBrowser(
      {
        BROWSER: {} as Fetcher,
      },
      {
        mode: "advertiser",
        filters: {
          query: "nykaa",
          country: "India",
          platform: "all",
          creativeType: "all",
          status: "all",
          firstSeenFrom: "",
          lastSeenFrom: "",
        },
      },
    );

    expect(launch).toHaveBeenCalledWith({} as Fetcher);
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining("country=IN"), expect.any(Object));
    expect(page.goto).toHaveBeenCalledWith(expect.stringContaining("q=nykaa"), expect.any(Object));
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
          source: "meta",
        }),
      ],
    });
    expect(browser.close).toHaveBeenCalled();
  });

  it("fails honestly when Browser Run is unavailable", async () => {
    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {},
        {
          mode: "keyword",
          filters: {
            query: "nykaa",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "browser_unavailable",
    });
  });

  it("classifies Browser Run 429 launch failures as rate limited", async () => {
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Unable to create new browser: code: 429: message: Rate limit exceeded"));

    vi.doMock("@cloudflare/puppeteer", () => ({
      default: { launch },
    }));

    const { searchMetaLibraryByBrowser, CommercialDiscoveryError } = await import(
      "~/lib/meta-library-browser.server"
    );

    await expect(
      searchMetaLibraryByBrowser(
        {
          BROWSER: {} as Fetcher,
        },
        {
          mode: "advertiser",
          filters: {
            query: "nykaa",
            country: "India",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
        },
      ),
    ).rejects.toMatchObject({
      name: CommercialDiscoveryError.name,
      failureClass: "rate_limited",
    });
  });
});
