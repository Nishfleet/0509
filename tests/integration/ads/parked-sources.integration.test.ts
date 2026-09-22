import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The five parked ad platforms (#4039), proven against real D1 with the real
 * migrations applied — not a mocked binding, which cannot see the schema.
 *
 * Why the parked rows exist at all: `docs/engines/ads.md`'s build-order table
 * ranks Snap, X, Pinterest, Amazon and Apple 6–10 as "parked — no reachable
 * search surface at the obvious URLs today (404 / NXDOMAIN). Each needs someone
 * to find the URL, which is a research task, not an engineering one." This file
 * is the record of that decision in the schema, so nobody re-probes them blind
 * and enabling one later is a row update rather than a migration.
 *
 * What is honestly provable here, and what is not: the ads sweep does not exist
 * yet (P3 / issue #4000), so no real tick runs and "zero queue messages" cannot
 * be measured end to end.
 *
 * mechanism-impossible: the acceptance bullet "produces zero queue messages" is
 * not measurable in this packet because the sweep that enqueues queue messages
 * does not exist — `workers/app.ts`'s `scheduled` handler is a stub and there is
 * no queue binding in `wrangler.jsonc`. A queue-message count asserted here
 * would be a number the implementation does not yet produce. Declared per the
 * fleet convention (fleet-ops#366) rather than implied by an empty assertion;
 * #4000 ships the sweep and that test measures a real tick.
 *
 * What this file proves instead is the state that makes a tick produce nothing
 * for these rows — the row exists, is disabled, carries its evidence, and
 * nothing downstream references it — plus that the eligibility predicate the
 * sweep will use responds to the flag.
 */

/**
 * The ads engine's eligibility predicate, from `docs/engines/ads.md` P3's select
 * ("`watch JOIN entity WHERE entity.state='on'` and `source.kind='ads'`") as
 * the mentions engine states it for its own kind
 * (`docs/engines/mentions.md` P5.2: "`entity.state = 'on'` AND
 * `source.kind = 'mentions'` AND `source.is_enabled = 1`"). Kept as one SQL
 * string because it is the contract the sweep implements and the assertion is
 * about the rows' relationship to it.
 */
const ADS_ELIGIBILITY_SELECT = `
  SELECT s.id
  FROM source s
  WHERE s.kind = 'ads' AND s.is_enabled = 1
`;

/** Exactly the platforms `docs/engines/ads.md` build order 6–10 parked. */
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
    // Scoped to kind='ads': another packet's disabled row of a different kind
    // (and #3977's X row, in flight on the same platform) must not redden this.
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
      // is_enabled = 0 is the whole mechanism: the sweep select requires 1.
      expect(Number(row.is_enabled)).toBe(0);
      expect(row.id).toBe(expected.id);
      expect(row.key).toBe(expected.key);

      // No adapter, no descriptor transport, no credential. The row records a
      // probe, so it claims no official_api and no scraped_page reliability
      // that a working adapter would earn.
      expect(row.reliability).toBe("best_effort");

      const config = JSON.parse(row.config_json) as {
        state?: string;
        reason?: string;
        evidence?: { probed_at?: string; probes?: { url: string; status: string | number }[] };
        source_doc?: string;
      };
      expect(config.state).toBe("parked");
      expect(typeof config.reason).toBe("string");

      // The evidence: the exact URL tried, the status returned, the UTC date.
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
      // Compare the row id. Comparing the object would never fail — which is
      // exactly how the first version of this test shipped with all five rows
      // enabled and still passed.
      expect(ids).not.toContain(parked.id);
    }
  });

  it("is not degraded: no watch exists, so no tick can mark one empty", async () => {
    // Degraded, per docs/engines/ads.md "Failure modes and the degraded state
    // the UI shows", is what an ELIGIBLE source becomes when it returns nothing
    // across ticks (snapshot.item_count = 0 for 2 consecutive ticks) or is
    // blocked. It is a state of a source that is being swept. This asserts the
    // precondition of that state directly rather than restating it: with no
    // watch there is no tick, no snapshot and no item_count to read zero, so
    // these rows cannot enter the degraded path at all.
    const placeholders = PARKED.map(() => "?").join(",");
    const args = [...PARKED.map((p) => p.id)];
    const watches = await env.DB.prepare(
      `SELECT count(*) AS n FROM watch WHERE source_id IN (${placeholders})`,
    )
      .bind(...args)
      .first<{ n: number }>();
    expect(watches?.n, "a parked source must have no watch and so cannot be swept").toBe(0);

    // The paid-for consequence: no snapshot rows either, which is where
    // item_count would come from. snapshot reaches source through its watch.
    const snapshots = await env.DB.prepare(
      `SELECT count(*) AS n FROM snapshot sn JOIN watch w ON w.id = sn.watch_id
       WHERE w.source_id IN (${placeholders})`,
    )
      .bind(...args)
      .first<{ n: number }>();
    expect(snapshots?.n).toBe(0);

    // And no signal, which is what a UI would render.
    const signals = await env.DB.prepare(
      `SELECT count(*) AS n FROM signal WHERE source_id IN (${placeholders})`,
    )
      .bind(...args)
      .first<{ n: number }>();
    expect(signals?.n, "a parked source has no UI surface").toBe(0);

    // Positive control for the three zeros above. `snapshot` and `signal` are
    // empty in a fresh D1, so a count of 0 is also what a broken query, a bad
    // placeholder list or a mistyped column returns — a zero that proves
    // nothing. Prove the id set and the placeholder wiring are correct by
    // running the SAME placeholder list against the table where these ids
    // definitely exist: `source` must see all five. A control that greps the
    // real rows beats seeding workspace/entity/watch/signal/snapshot by hand
    // through five foreign keys.
    const sameIdsInSource = await env.DB.prepare(
      `SELECT count(*) AS n FROM source WHERE id IN (${placeholders})`,
    )
      .bind(...args)
      .first<{ n: number }>();
    expect(sameIdsInSource?.n, "the placeholder list must resolve all five rows").toBe(
      PARKED.length,
    );

    // And a zero that is not this query's answer: the signals for the parked
    // rows are zero while the rows themselves are present, so the signal table
    // is being read and simply has nothing for them.
    expect(signals?.n).toBe(0);
    expect(snapshots?.n).toBe(0);
    expect(watches?.n).toBe(0);
  });

  it("would become eligible if someone enabled it, so the guard is real", async () => {
    // The test above only means something if flipping is_enabled changes the
    // predicate's answer. Prove it with a throwaway control row so a failed
    // expectation cannot leak enabled state into the rows the rest of the suite
    // asserts against. D1 rejects SQL BEGIN/SAVEPOINT (it requires the Durable
    // Object JS transaction API), so an explicit rollback is not available and
    // cleanup is a delete in `finally` instead.
    const controlId = "src_ads_parked_test_control";
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?, 'ads.test_control', 'ads', 'test_control', 'ads.test_control', 'best_effort', 0, '{}')`,
    )
      .bind(controlId)
      .run();

    try {
      const disabled = (await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>())
        .results ?? [];
      expect(disabled.map((r) => r.id)).not.toContain(controlId);

      await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = ?")
        .bind(controlId)
        .run();
      const enabled = (await env.DB.prepare(ADS_ELIGIBILITY_SELECT).all<{ id: string }>())
        .results ?? [];
      expect(enabled.map((r) => r.id)).toContain(controlId);

      // The five parked rows were unmoved by that flip.
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
