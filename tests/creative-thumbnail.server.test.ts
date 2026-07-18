import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/public-url.server");
  vi.doUnmock("~/lib/fetch-timeout.server");
  vi.doUnmock("~/lib/bounded-response.server");
});

describe("creative artifact keys and paths", () => {
  it("builds a stable R2 key and rejects path traversal", async () => {
    const {
      creativeArtifactObjectKey,
      parseCreativeArtifactPathname,
      buildCreativeArtifactUrl,
    } = await import("~/lib/creative-thumbnail.server");

    expect(creativeArtifactObjectKey("ad_123.abc")).toBe("creatives/ad_123.abc");
    expect(creativeArtifactObjectKey("../etc/passwd")).toBeNull();
    expect(creativeArtifactObjectKey("a/b")).toBeNull();
    expect(creativeArtifactObjectKey("")).toBeNull();

    expect(parseCreativeArtifactPathname("/artifacts/creatives/ad_1")).toBe("ad_1");
    expect(parseCreativeArtifactPathname("/artifacts/creatives/ad%3A2")).toBe("ad:2");
    expect(parseCreativeArtifactPathname("/artifacts/other/ad_1")).toBeNull();

    expect(
      buildCreativeArtifactUrl(
        { APP_ORIGIN: "https://0509.io/" } as never,
        "meta-1",
      ),
    ).toBe("https://0509.io/artifacts/creatives/meta-1");
  });
});

describe("persistCreativeThumbnailForSavedAd", () => {
  it("stores image bytes in R2 and returns the durable artifact URL", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const head = vi.fn().mockResolvedValue(null);
    const bytes = new Uint8Array([1, 2, 3, 4]);

    vi.doMock("~/lib/public-url.server", () => ({
      resolvePublicHttpUrl: vi.fn(async (value: string) => new URL(value)),
      resolvePublicRedirectUrl: vi.fn(),
    }));
    vi.doMock("~/lib/fetch-timeout.server", () => ({
      fetchWithTimeout: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "image/jpeg" : null,
        },
        url: "https://scontent.xx.fbcdn.net/v/t.jpg?oh=sig",
      }),
      releaseFetchTimeout: vi.fn(),
    }));
    vi.doMock("~/lib/bounded-response.server", () => ({
      contentLengthExceeds: vi.fn().mockReturnValue(false),
      readResponseBytesWithinLimit: vi.fn().mockResolvedValue(bytes),
    }));

    const { persistCreativeThumbnailForSavedAd } = await import(
      "~/lib/creative-thumbnail.server"
    );

    const result = await persistCreativeThumbnailForSavedAd(
      {
        APP_ORIGIN: "https://0509.io",
        LANDING_PAGE_ARTIFACTS: { put, head },
      } as never,
      {
        metaAdId: "meta_ad_42",
        creativeImageUrl: "https://scontent.xx.fbcdn.net/v/t.jpg?oh=sig",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1",
      },
    );

    expect(result).toBe("https://0509.io/artifacts/creatives/meta_ad_42");
    expect(put).toHaveBeenCalledWith(
      "creatives/meta_ad_42",
      bytes,
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: "image/jpeg",
          cacheControl: expect.stringContaining("max-age=31536000"),
        }),
      }),
    );
  });

  it("keeps the original URL when R2 is missing or fetch fails", async () => {
    vi.doMock("~/lib/public-url.server", () => ({
      resolvePublicHttpUrl: vi.fn().mockResolvedValue(null),
      resolvePublicRedirectUrl: vi.fn(),
    }));
    vi.doMock("~/lib/fetch-timeout.server", () => ({
      fetchWithTimeout: vi.fn(),
      releaseFetchTimeout: vi.fn(),
    }));
    vi.doMock("~/lib/bounded-response.server", () => ({
      contentLengthExceeds: vi.fn(),
      readResponseBytesWithinLimit: vi.fn(),
    }));

    const { persistCreativeThumbnailForSavedAd } = await import(
      "~/lib/creative-thumbnail.server"
    );

    const original = "https://scontent.xx.fbcdn.net/v/t.jpg?oh=sig";
    const withoutBucket = await persistCreativeThumbnailForSavedAd(
      { APP_ORIGIN: "https://0509.io" } as never,
      { metaAdId: "m1", creativeImageUrl: original, adSnapshotUrl: null },
    );
    expect(withoutBucket).toBe(original);

    const blocked = await persistCreativeThumbnailForSavedAd(
      {
        APP_ORIGIN: "https://0509.io",
        LANDING_PAGE_ARTIFACTS: { put: vi.fn(), head: vi.fn().mockResolvedValue(null) },
      } as never,
      { metaAdId: "m1", creativeImageUrl: original, adSnapshotUrl: null },
    );
    expect(blocked).toBe(original);
  });

  it("reuses an existing R2 object without re-fetching", async () => {
    const put = vi.fn();
    const head = vi.fn().mockResolvedValue({ key: "creatives/m1" });
    const fetchWithTimeout = vi.fn();

    vi.doMock("~/lib/public-url.server", () => ({
      resolvePublicHttpUrl: vi.fn(),
      resolvePublicRedirectUrl: vi.fn(),
    }));
    vi.doMock("~/lib/fetch-timeout.server", () => ({
      fetchWithTimeout,
      releaseFetchTimeout: vi.fn(),
    }));
    vi.doMock("~/lib/bounded-response.server", () => ({
      contentLengthExceeds: vi.fn(),
      readResponseBytesWithinLimit: vi.fn(),
    }));

    const { persistCreativeThumbnailForSavedAd } = await import(
      "~/lib/creative-thumbnail.server"
    );

    const result = await persistCreativeThumbnailForSavedAd(
      {
        APP_ORIGIN: "https://0509.io",
        LANDING_PAGE_ARTIFACTS: { put, head },
      } as never,
      {
        metaAdId: "m1",
        creativeImageUrl: "https://scontent.xx.fbcdn.net/v/t.jpg",
        adSnapshotUrl: null,
      },
    );

    expect(result).toBe("https://0509.io/artifacts/creatives/m1");
    expect(put).not.toHaveBeenCalled();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe("serveCreativeArtifact", () => {
  it("serves bytes with long cache headers and 404s when missing", async () => {
    const body = new Uint8Array([9, 9, 9]);
    const get = vi.fn().mockResolvedValue({
      body,
      etag: '"abc"',
      httpMetadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    const { serveCreativeArtifact } = await import("~/lib/creative-thumbnail.server");

    const ok = await serveCreativeArtifact(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/creatives/m1"),
      "m1",
    );
    expect(ok?.status).toBe(200);
    expect(ok?.headers.get("cache-control")).toContain("31536000");
    expect(ok?.headers.get("content-type")).toBe("image/jpeg");

    get.mockResolvedValueOnce(null);
    const missing = await serveCreativeArtifact(
      { LANDING_PAGE_ARTIFACTS: { get } } as never,
      new Request("https://0509.io/artifacts/creatives/missing"),
      "missing",
    );
    expect(missing?.status).toBe(404);
  });
});
