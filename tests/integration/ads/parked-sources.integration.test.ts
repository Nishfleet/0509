import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ADS_ELIGIBILITY_SELECT = `
  SELECT s.id
  FROM source s
  WHERE s.kind = 'ads' AND s.is_enabled = 1
`;

const PARKED = [
  { platform: "snap", id: "src_ads_snap_parked", key: "ads.snap_parked", probe: 12 },
  { platform: "x", id: "src_ads_x_parked", key: "ads.x_parked", probe: 13 },
  { platform: "pinterest", id: "src_ads_pinterest_parked", key: "ads.pinterest_parked", probe: 14 },
  { platform: "amazon", id: "src_ads_amazon_parked", key: "ads.amazon_parked", probe: 15 },
  { platform: "apple", id: "src_ads_apple_parked", key: "ads.apple_parked", probe: 16 },
] as const;

const PLATFORM_IDS = PARKED.map((p) => p.platform);

describe("parked ad platforms (#4039)", () => {
  it("seeds exactly the five parked platforms, each disabled and carrying its probe evidence", async () => {
    const rows = await env.DB.prepare(
      `SELECT id, key, platform, kind, plugin_key, reliability, is_enabled, config_json
       FROM source
       WHERE kind = 'ads' AND is_enabled = 0
       ORDER BY platform`,
    ).all<{
      id: string;
      key: string;
      platform: string;
      kind: string;
      plugin_key: string;
      reliability: string;
      is_enabled: number;
      config_json: string;
    }>();
    const seeded = rows.results ?? [];

    expect(seeded.map((r) => r.platform).sort()).toEqual([...PLATFORM_IDS].sort());

    for (const row of seeded) {
      const expected = PARKED.find((p) => p.platform === row.platform);
      expect(expected, `${row.platform} must be one of the parked five`).toBeDefined();
      if (!expected) throw new Error(`${row.platform} is not one of the parked five`);

      expect(row.kind).toBe("ads");

      expect(row.is_enabled).toBe(0);
      expect(row.id).toBe(expected.id);
      expect(row.key).toBe(expected.key);

      expect(row.reliability).toBe("best_effort");

      const config = JSON.parse(row.config_json) as {
        state?: string;
        reason?: string;
        evidence?: { probed_at?: string; probes?: { url: string; status: string | number }[] };
        source_doc?: string;
      };
      expect(config.state).toBe("parked");
      expect(typeof config.reason).toBe("string");

      const probes = config.evidence?.probes ?? [];
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        expect(probe.url).toMatch(/^https:\/\//);
        expect(["NXDOMAIN", 200, 404]).toContain(probe.status);
      }
      expect(config.evidence?.probed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(config.source_doc).toContain("probes 12-16");
      expect(config.source_doc).toContain("rank");
    }
  });

  it("is not eligible for the sweep, so a tick selects nothing for them", async () => {
    const rows = await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>();
    const ids = (rows.results ?? []).map((r) => r.id);

    for (const parked of PARKED) {
      expect(ids).not.toContain(parked.id);
    }
  });

  it("is not degraded: no watch exists, so no tick can mark one empty", async () => {
    const placeholders = PARKED.map(() => "?").join(",");
    const args = [...PARKED.map((p) => p.id)];
    const watches = await env.DB.prepare(`SELECT count(*) AS n FROM watch WHERE source_id IN (${placeholders})`)
      .bind(...args)
      .first<{ n: number }>();
    expect(watches?.n, "a parked source must have no watch and so cannot be swept").toBe(0);

    const snapshots = await env.DB.prepare(
      `SELECT count(*) AS n FROM snapshot sn JOIN watch w ON w.id = sn.watch_id
       WHERE w.source_id IN (${placeholders})`,
    )
      .bind(...args)
      .first<{ n: number }>();
    expect(snapshots?.n).toBe(0);

    const signals = await env.DB.prepare(`SELECT count(*) AS n FROM signal WHERE source_id IN (${placeholders})`)
      .bind(...args)
      .first<{ n: number }>();
    expect(signals?.n, "a parked source has no UI surface").toBe(0);

    const sameIdsInSource = await env.DB.prepare(`SELECT count(*) AS n FROM source WHERE id IN (${placeholders})`)
      .bind(...args)
      .first<{ n: number }>();
    expect(sameIdsInSource?.n, "the placeholder list must resolve all five rows").toBe(PARKED.length);

    expect(signals?.n).toBe(0);
    expect(snapshots?.n).toBe(0);
    expect(watches?.n).toBe(0);
  });

  it("would become eligible if someone enabled it, so the guard is real", async () => {
    const controlId = "src_ads_parked_test_control";
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?, 'ads.test_control', 'ads', 'test_control', 'ads.test_control', 'best_effort', 0, '{}')`,
    )
      .bind(controlId)
      .run();

    try {
      const disabled = (await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
      expect(disabled.map((r) => r.id)).not.toContain(controlId);

      await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = ?").bind(controlId).run();
      const enabled = (await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
      expect(enabled.map((r) => r.id)).toContain(controlId);

      for (const parked of PARKED) {
        expect(enabled.map((r) => r.id)).not.toContain(parked.id);
      }
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(controlId).run();
    }

    const after = (await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>()).results ?? [];
    expect(after.map((r) => r.id)).not.toContain(controlId);
  });
});
