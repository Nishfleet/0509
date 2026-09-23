import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { parseAdsDescriptor } from "../../../app/lib/ads/descriptor";

/**
 * The Meta ads source row (#3974), read back from real D1 after the real
 * migrations run. The write is the INSERT in migrations/0007_meta_ads_source.sql.
 * There is no second writer: persisting creatives is a later packet.
 */

describe("meta ads source (#3974)", () => {
  it("seeds one enabled scraped_page row whose config_json is a descriptor", async () => {
    const row = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source WHERE id = ?`,
    )
      .bind("src_ads_meta")
      .first<{
        id: string;
        key: string;
        kind: string;
        platform: string;
        plugin_key: string;
        reliability: string;
        is_enabled: number;
        config_json: string;
      }>();

    if (row === null) {
      throw new Error("src_ads_meta missing");
    }
    expect(row.key).toBe("ads.meta");
    expect(row.kind).toBe("ads");
    expect(row.platform).toBe("meta");
    expect(row.plugin_key).toBe("ads.meta");
    expect(row.reliability).toBe("scraped_page");
    expect(Number(row.is_enabled)).toBe(1);

    const descriptor = parseAdsDescriptor(row.config_json);
    expect(descriptor.transport).toBe("browser");
    expect(descriptor.method).toBe("GET");
    expect(descriptor.auth).toEqual({ kind: "none" });
    expect(descriptor.reliability).toBe("scraped_page");
    expect(descriptor.rateLimitPerMinute).toBe(1);
    expect(descriptor.waitForSelector).toBe('script[type="application/json"]');
    expect(descriptor.endpoint).toContain("https://www.facebook.com/ads/library/");
    expect(descriptor.endpoint).toContain("{target}");
    expect(descriptor.endpoint).not.toContain("graph.facebook.com");
    expect(descriptor.paginationCursorPath).toBeUndefined();
  });

  it("is eligible for an ads select", async () => {
    const rows = await env.DB.prepare(
      `SELECT id FROM source WHERE kind = 'ads' AND is_enabled = 1`,
    ).all<{ id: string }>();
    expect((rows.results ?? []).map((result) => result.id)).toContain("src_ads_meta");
  });
});
