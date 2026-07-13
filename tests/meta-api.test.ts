import { afterEach, describe, expect, it, vi } from "vitest";

import { MetaApiError, searchAds } from "~/lib/meta-api.server";
import { normalizeSavedQuery } from "~/lib/normalize";

const query = normalizeSavedQuery("keyword", {
  query: "cod",
  country: "India",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchAds", () => {
  it("uses demo data when no Meta token is configured", async () => {
    const result = await searchAds({} as never, query, null, {
      allowDemoFallback: false,
    });

    expect(result.source).toBe("demo");
  });

  it("defaults allowDemoFallback to false and throws on live Meta errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: "Bad token",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    // No options argument — default must not silently fall back to demo.
    await expect(
      searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("throws the live Meta error when fallback is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: "Bad token",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(
      searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null, {
        allowDemoFallback: false,
      }),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("falls back to demo data for public search when fallback is enabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 613,
            message: "Rate limited",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const result = await searchAds(
      { META_AD_LIBRARY_TOKEN: "token" } as never,
      query,
      null,
      { allowDemoFallback: true },
    );

    expect(result.source).toBe("demo");
  });

  it("uses ad_reached_countries for live Meta queries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null, {
      allowDemoFallback: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("ad_reached_countries")).toBe("IN");
    expect(requestUrl.searchParams.get("country")).toBeNull();
  });

  it("treats malformed successful Meta JSON as a provider error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{not-json", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await expect(
      searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null, {
        allowDemoFallback: false,
      }),
    ).rejects.toBeInstanceOf(MetaApiError);
  });
});
