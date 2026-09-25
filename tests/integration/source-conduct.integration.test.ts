import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * Collection conduct on every `source` registry row (#5147, the P10.5a slice of
 * engine 10 / #4078; docs/engines/guardrails.md § P10.5).
 *
 * The rate that governs a source and whether it honours robots.txt live in the
 * row's `config_json`, not in an adapter, so a source's conduct is data the
 * registry carries. Migration 0023 records both for every row that exists when
 * it runs; these assertions run against the real local D1 with the real
 * migrations applied — a mocked binding cannot see the schema.
 *
 * The values: `honoured` = robots.txt is obeyed; `logged_out_browser` =
 * competitor public pages are fetched only as a logged-out browser would see
 * them (Nish, 2026-09-21); `api_terms` = an official API its terms govern.
 */

describe("collection conduct on every source row (#5147, P10.5a)", () => {
  it("leaves no source row without a robots policy", async () => {
    const missing = await env.DB.prepare(
      "SELECT key FROM source WHERE json_extract(config_json, '$.robots') IS NULL",
    ).all<{ key: string }>();
    expect(missing.results ?? []).toEqual([]);
  });

  it("records GDELT's six-second pace on its registry row", async () => {
    // The pace workers/workflows/mentions.ts keeps with `PACE = "6 seconds"`.
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
    // The migration is a data-only UPDATE, so the new WRITE is its json_set
    // shape. A fresh row written that way must read back through the same
    // extracts the readers use. Dedicated row, deleted in `finally` — the
    // shipped rows are never mutated, and is_enabled stays 0 (no source is
    // enabled by this test).
    const id = "src_source_conduct_roundtrip";
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?, 'test.source_conduct', 'site', 'conduct-test', 'test.conduct', 'scraped_page', 0, '{}')`,
    )
      .bind(id)
      .run();

    try {
      // Exactly the two statements migration 0023 runs, scoped to this row.
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
