import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("collection conduct on every source row (#5147, P10.5a)", () => {
  it("leaves no source row without a robots policy", async () => {
    const missing = await env.DB.prepare(
      "SELECT key FROM source WHERE json_extract(config_json, '$.robots') IS NULL",
    ).all<{ key: string }>();
    expect(missing.results ?? []).toEqual([]);
  });

  it("records GDELT's six-second pace on its registry row", async () => {
    const row = await env.DB.prepare(
      `SELECT json_extract(config_json, '$.min_interval_seconds') AS s
       FROM source WHERE key = 'gdelt.doc'`,
    ).first<{ s: number }>();
    expect(row?.s).toBe(6);
  });

  it("splits the site source's own site from a competitor's public page", async () => {
    const row = await env.DB.prepare(
      `SELECT json_extract(config_json, '$.robots.self') AS self,
              json_extract(config_json, '$.robots.competitor') AS competitor
       FROM source WHERE key = 'site.web'`,
    ).first<{ self: string; competitor: string }>();
    expect(row?.self).toBe("honoured");
    expect(row?.competitor).toBe("logged_out_browser");
  });

  it("round-trips the migration's write shape on a dedicated row", async () => {
    const id = "src_source_conduct_roundtrip";
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?, 'test.source_conduct', 'site', 'conduct-test', 'test.conduct', 'scraped_page', 0, '{}')`,
    )
      .bind(id)
      .run();

    try {
      await env.DB.prepare(
        "UPDATE source SET config_json = json_set(config_json, '$.min_interval_seconds', 6) WHERE id = ?",
      )
        .bind(id)
        .run();
      await env.DB.prepare(
        `UPDATE source SET config_json = json_set(config_json, '$.robots',
           CASE
             WHEN kind = 'site' THEN json('{"self":"honoured","competitor":"logged_out_browser"}')
             WHEN plugin_key IN ('youtube.channel_rss', 'medium.tag_rss') THEN 'honoured'
             ELSE 'api_terms'
           END)
         WHERE id = ?`,
      )
        .bind(id)
        .run();

      const row = await env.DB.prepare(
        `SELECT json_extract(config_json, '$.min_interval_seconds') AS s,
                json_extract(config_json, '$.robots.self') AS self,
                json_extract(config_json, '$.robots.competitor') AS competitor
         FROM source WHERE id = ?`,
      )
        .bind(id)
        .first<{ s: number; self: string; competitor: string }>();
      expect(row?.s).toBe(6);
      expect(row?.self).toBe("honoured");
      expect(row?.competitor).toBe("logged_out_browser");
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(id).run();
    }
  });
});
