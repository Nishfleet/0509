import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The Meta ads source row (#3974), read back from real D1 after the real
 * migrations run. The write is the INSERT in migrations/0006_meta_ads_source.sql.
 * There is no second writer: persisting creatives is a later packet.
 */

describe("meta ads source (#3974)", () => {
  it("seeds one enabled scraped_page row and the descriptor", async () => {
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

    expect(row).not.toBeNull();
    if (!row) {
      return;
    }
    expect(row.key).toBe("ads.meta");
    expect(row.kind).toBe("ads");
    expect(row.platform).toBe("meta");
    expect(row.plugin_key).toBe("ads.meta");
    expect(row.reliability).toBe("scraped_page");
    expect(Number(row.is_enabled)).toBe(1);

    const config = JSON.parse(row.config_json) as {
      endpoint_template?: string;
      method?: string;
      auth?: string;
      wait_for?: string;
      pagination_cursor_path?: string;
      reliability?: string;
      plain_fetch?: { status?: number; url?: string };
      graph_ads_archive?: { call?: boolean };
    };
    expect(config.method).toBe("GET");
    expect(config.auth).toBe("none");
    expect(config.reliability).toBe("scraped_page");
    expect(config.endpoint_template).toContain("https://www.facebook.com/ads/library/");
    expect(config.endpoint_template).not.toContain("graph.facebook.com");
    expect(config.wait_for).toBe('script[type="application/json"]');
    expect(config.pagination_cursor_path).toBe("search_results_connection.page_info.end_cursor");
    expect(config.plain_fetch?.status).toBe(403);
    expect(config.plain_fetch?.url).toContain("facebook.com/ads/library/");
    expect(config.graph_ads_archive?.call).toBe(false);
  });

  it("is eligible for an ads select", async () => {
    const rows = await env.DB.prepare(
      `SELECT id FROM source WHERE kind = 'ads' AND is_enabled = 1`,
    ).all<{ id: string }>();
    expect((rows.results ?? []).map((result) => result.id)).toContain("src_ads_meta");
  });
});
