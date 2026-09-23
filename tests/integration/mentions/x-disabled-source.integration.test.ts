import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * X as a disabled mentions source row (#3977 / docs/engines/mentions.md P5.6),
 * proven against real D1 with the real migrations applied — not a mocked
 * binding, which cannot see the schema.
 *
 * The point of the packet: a source we have decided not to pay for is invisible
 * to the product — not polled, not counted, not rendered — so enabling it later
 * is one `UPDATE source SET is_enabled = 1` and never a migration. The row
 * carries Nish's 2026-09-22 decision and the cheapest known route (Apify,
 * roughly $0.40 per 1,000 tweets) with approved_cost left null.
 *
 * What is honestly provable here, and what is not: the mentions cron and its
 * two queues do not exist yet — they ship in #3976 — so no real tick runs.
 *
 * mechanism-impossible: the parent's acceptance bullet "zero queue messages /
 * a queue message on flip" is not measurable in this packet because the cron
 * that enqueues mentions queue messages and the queues they land on ship in
 * #3976. A queue-message count asserted here would be a number the
 * implementation does not yet produce. Declared per the fleet convention
 * (fleet-ops#366) rather than implied by an empty assertion; #3976 ships the
 * tick and that test measures a real enqueue. What this file proves instead is
 * the state that makes a tick produce nothing for this row — the row exists,
 * is disabled, and nothing downstream references it — plus that the
 * eligibility predicate the cron will use (P5.2) responds to the flag.
 */

/**
 * The mentions engine's eligibility predicate, from `docs/engines/mentions.md`
 * P5.2 ("`entity.state = 'on'` AND `source.kind = 'mentions'` AND
 * `source.is_enabled = 1`") with the watch join collapsed to the row's own
 * columns, because there is no watch for this row yet and the flag lives on the
 * row. Kept as one SQL string because it is the contract the cron implements
 * and the assertion is about the row's relationship to it.
 */
const MENTIONS_ELIGIBILITY_SELECT = `
  SELECT s.id
  FROM source s
  WHERE s.kind = 'mentions' AND s.is_enabled = 1
`;

describe("X as a disabled mentions source row (#3977)", () => {
  it("seeds the row, disabled, with the decision and the cheapest route and no state key", async () => {
    // Scoped to the exact id: ads' parked rows (and any other packet's rows)
    // must not redden this. Exactly one row with this id.
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

    // is_enabled = 0 is the whole mechanism: the P5.2 select requires 1.
    expect(Number(row.is_enabled)).toBe(0);

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

    // No `state` key on purpose: source-pill.tsx hides any row whose
    // config_json.state is "disabled" or "parked", so a state key would make
    // enabling take two edits instead of one UPDATE. Its absence here is part
    // of the contract, not an omission.
    expect("state" in config).toBe(false);
  });

  it("is not eligible, so the P5.2 select returns nothing for it", async () => {
    const rows = await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>();
    const ids = (rows.results ?? []).map((r) => r.id);

    // Compare the row id. Comparing the object would never fail — which is
    // exactly how the ads packet's first version shipped with five rows
    // enabled and still passed.
    expect(ids).not.toContain("src_mentions_x");
  });

  it("has no watch, snapshot or signal, so it is invisible to the product", async () => {
    // P5.6: "not polled, not counted, not rendered". With no watch there is no
    // tick, and snapshot reaches source through its watch, so all three counts
    // must be zero for the row.
    const id = "src_mentions_x";
    const watches = await env.DB.prepare(
      "SELECT count(*) AS n FROM watch WHERE source_id = ?",
    )
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

    // Positive control for the three zeros above. `watch`, `snapshot` and
    // `signal` are all empty in a fresh D1, so a count of 0 is also what a
    // broken query, a mistyped column or a bad binding returns — a zero that
    // proves nothing. Prove the binding is correct by running the SAME bind
    // list against the table where this id definitely exists: `source` must
    // return 1.
    const sameIdInSource = await env.DB.prepare("SELECT count(*) AS n FROM source WHERE id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(sameIdInSource?.n, "the bind list must resolve the row").toBe(1);

    // And a zero that is not this query's answer: the three tables above were
    // read and genuinely have nothing for the row, while the row itself is
    // present.
    expect(watches?.n).toBe(0);
    expect(snapshots?.n).toBe(0);
    expect(signals?.n).toBe(0);
  });

  it("becomes eligible from a single UPDATE, so the enable path is a row update", async () => {
    // The tests above only mean something if flipping is_enabled changes the
    // predicate's answer. Prove it on a copy of the row so a failed expectation
    // cannot leak enabled state into the row the rest of the suite asserts
    // against. D1 rejects SQL BEGIN/SAVEPOINT (it requires the Durable Object
    // JS transaction API), so an explicit rollback is not available and cleanup
    // is a delete in `finally` instead.
    const controlId = "src_mentions_x_test_control";

    // Copy config_json straight from the shipped row, so the control flips the
    // same bytes the decision rests on.
    const source = await env.DB.prepare(
      "SELECT config_json FROM source WHERE id = ?",
    )
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
      const disabled = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>())
        .results ?? [];
      expect(disabled.map((r) => r.id)).not.toContain(controlId);

      await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = ?")
        .bind(controlId)
        .run();
      const enabled = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>())
        .results ?? [];
      expect(enabled.map((r) => r.id)).toContain(controlId);

      // The shipped row was unmoved by that flip: enabling is per-row.
      expect(enabled.map((r) => r.id)).not.toContain("src_mentions_x");
    } finally {
      await env.DB.prepare("DELETE FROM source WHERE id = ?").bind(controlId).run();
    }

    const after = (await env.DB.prepare(MENTIONS_ELIGIBILITY_SELECT).all<{ id: string }>())
      .results ?? [];
    expect(after.map((r) => r.id)).not.toContain(controlId);
  });
});
