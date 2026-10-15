import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const MENTIONS_ELIGIBILITY_SELECT = `
  SELECT s.id
  FROM source s
  WHERE s.kind = 'mentions' AND s.is_enabled = 1
`;

describe("X as a disabled mentions source row (#3977)", () => {
  it("seeds the row, disabled, with the decision and the cheapest route and no state key", async () => {
    const rows = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source
       WHERE id = ?`,
    )
      .bind("src_mentions_x")
      .all<{
        id: string;
        key: string;
        kind: string;
        platform: string;
        plugin_key: string;
        reliability: string;
        is_enabled: number;
        config_json: string;
      }>();
    const seeded = rows.results ?? [];
    expect(seeded).toHaveLength(1);
    const row = seeded[0];
    if (!row) throw new Error("src_mentions_x is missing from source");

    expect(row.id).toBe("src_mentions_x");
    expect(row.kind).toBe("mentions");
    expect(row.platform).toBe("x");
    expect(row.key).toBe("x.search");

    expect(row.is_enabled).toBe(0);

    const config = JSON.parse(row.config_json) as {
      disabled_reason?: string;
      decided_by?: string;
      decided_at?: string;
      cheapest_route?: { provider?: string; usd_per_1000_tweets?: number };
      approved_cost?: number | null;
      source_doc?: string;
      state?: string;
    };
    expect(config.approved_cost).toBe(null);
    expect(config.cheapest_route?.provider).toBe("Apify");
    expect(config.cheapest_route?.usd_per_1000_tweets).toBe(0.4);
    expect(config.decided_at).toBe("2026-09-22");

    expect("state" in config).toBe(false);
  });

  it("is not eligible, so the P5.2 select returns nothing for it", async () => {
    const rows = await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>();
    const ids = (rows.results ?? []).map((r) => r.id);

    expect(ids).not.toContain("src_mentions_x");
  });

  it("has no watch, snapshot or signal, so it is invisible to the product", async () => {
    const id = "src_mentions_x";
    const watches = await env.DB.prepare("SELECT count(*) AS n FROM watch WHERE source_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(watches?.n, "a disabled source must have no watch and so cannot be polled").toBe(0);

    const snapshots = await env.DB.prepare(
      `SELECT count(*) AS n FROM snapshot sn JOIN watch w ON w.id = sn.watch_id
       WHERE w.source_id = ?`,
    )
      .bind(id)
      .first<{ n: number }>();
    expect(snapshots?.n).toBe(0);

    const signals = await env.DB.prepare("SELECT count(*) AS n FROM signal WHERE source_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(signals?.n, "a disabled source has no UI surface").toBe(0);

    const sameIdInSource = await env.DB.prepare("SELECT count(*) AS n FROM source WHERE id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(sameIdInSource?.n, "the bind list must resolve the row").toBe(1);

    expect(watches?.n).toBe(0);
    expect(snapshots?.n).toBe(0);
    expect(signals?.n).toBe(0);
  });

  it("becomes eligible from a single UPDATE, so the enable path is a row update", async () => {
    const controlId = "src_mentions_x_test_control";

    const source = await env.DB.prepare("SELECT config_json FROM source WHERE id = ?")
      .bind("src_mentions_x")
      .first<{ config_json: string }>();
    expect(source?.config_json, "the shipped row must exist to copy from").toBeTruthy();

    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?, 'x.test_control', 'mentions', 'x', 'x.test_control', 'best_effort', 0, ?)`,
    )
      .bind(controlId, source?.config_json ?? "")
      .run();

    try {
      const disabled = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
      expect(disabled.map((r) => r.id)).not.toContain(controlId);

      await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = ?").bind(controlId).run();
      const enabled = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
      expect(enabled.map((r) => r.id)).toContain(controlId);

      expect(enabled.map((r) => r.id)).not.toContain("src_mentions_x");
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(controlId).run();
    }

    const after = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
    expect(after.map((r) => r.id)).not.toContain(controlId);
  });
});
