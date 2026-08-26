import { describe, expect, it } from "vitest";

import { getDiscoveryCacheEntry, upsertDiscoveryCacheEntry } from "~/lib/data.server";
import { isDiscoveryCacheRouteCompatible } from "~/lib/discovery-cache.server";

import { appEnv, db, ISO_T0, uid } from "./fixtures";

/**
 * public_search_warmup must persist as public_search: the live D1 CHECKs on
 * discovery_cache_entry still only allow public_search | watchlist_scan |
 * scheduled_warmup. Expanding them needs a table rebuild, which this PR
 * must not do. The 24h TTL lives in expires_at, not in the stored context.
 */
describe("public_search_warmup cache writes against real D1", () => {
  it("stores warmup rows as public_search and public search can read them", async () => {
    const cacheKey = `search-v2:domain:allbirds.com:exact:meta_library_browser:all:${uid("page")}`;
    await upsertDiscoveryCacheEntry(appEnv, {
      cacheKey,
      provider: "meta_library_browser",
      routeContext: "public_search_warmup",
      queryFingerprint: "fp-allbirds-panel",
      country: "all",
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: "ad-allbirds-1",
            advertiser: "Allbirds",
            body: "Wool runners",
            previewHeadline: "Wool runners",
            previewSubhead: "Shop",
            hook: "Wool runners",
            offer: "",
            cta: "Shop",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: "https://allbirds.com",
            adSnapshotUrl: null,
            countries: ["United States"],
            platforms: ["Instagram"],
            firstSeenAt: ISO_T0,
            lastSeenAt: ISO_T0,
            active: true,
            researchSummary: "",
            source: "meta_library_browser",
            analysisFields: [],
          },
        ],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
      },
      fetchedAt: ISO_T0,
      expiresAt: "2026-08-27T00:00:00.000Z",
      browserMsUsed: 1200,
    });

    const row = await db()
      .prepare("SELECT route_context, json_array_length(json_extract(payload_json, '$.ads')) AS ad_count FROM discovery_cache_entry WHERE cache_key = ?")
      .bind(cacheKey)
      .first<{ route_context: string; ad_count: number }>();

    expect(row?.route_context).toBe("public_search");
    expect(row?.ad_count).toBe(1);
    expect(isDiscoveryCacheRouteCompatible("public_search", row?.route_context)).toBe(true);

    const entry = await getDiscoveryCacheEntry(appEnv, cacheKey);
    expect(entry?.routeContext).toBe("public_search");
    expect(entry?.payload.ads).toHaveLength(1);
  });

  it("rejects an unmapped public_search_warmup route_context at the CHECK", async () => {
    const cacheKey = `search-v2:domain:notion.so:exact:meta_library_browser:all:${uid("page")}`;
    await expect(
      db()
        .prepare(
          `INSERT INTO discovery_cache_entry (
             cache_key, provider, route_context, query_fingerprint, country, cursor,
             payload_json, fetched_at, expires_at, browser_ms_used, created_at, updated_at
           ) VALUES (?, 'meta_library_browser', 'public_search_warmup', 'fp', 'all', NULL, '{}', ?, ?, NULL, ?, ?)`,
        )
        .bind(cacheKey, ISO_T0, ISO_T0, ISO_T0, ISO_T0)
        .run(),
    ).rejects.toThrow(/CHECK|constraint/i);
  });
});
