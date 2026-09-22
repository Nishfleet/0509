import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * P5.6. migrations/0002_mentions_x_disabled.sql seeds the X row.
 * A disabled source is absent from the mentions eligibility join in
 * docs/engines/mentions.md and from both pill states.
 * Enabling it is an UPDATE of is_enabled on this same row.
 */

const X_ID = "src_mentions_x";

const ELIGIBLE = `
  SELECT w.id AS watch_id,
         s.id AS source_id,
         e.id AS entity_id,
         e.workspace_id AS workspace_id
  FROM watch w
  JOIN entity e ON e.id = w.entity_id
  JOIN source s ON s.id = w.source_id
  WHERE e.state = 'on'
    AND s.kind = 'mentions'
    AND s.is_enabled = 1
`;

const PILL = `
  SELECT id,
         CASE
           WHEN is_enabled != 1 THEN NULL
           WHEN json_type(config_json, '$.degraded_reason') IS NOT NULL
             AND json_type(config_json, '$.degraded_reason') != 'null'
             THEN 'degraded'
           ELSE 'live'
         END AS pill
  FROM source
  WHERE kind = 'mentions'
    AND id IN ('src_mentions_x', 'src_test_hn', 'src_test_degraded')
`;

type QueueMessage = {
  watch_id: string;
  source_id: string;
  entity_id: string;
  workspace_id: string;
};

async function tick(): Promise<QueueMessage[]> {
  const selected = await env.DB.prepare(ELIGIBLE).all<QueueMessage>();
  const messages = selected.results ?? [];
  for (const message of messages) {
    const existing = await env.DB.prepare(
      "SELECT count(*) AS n FROM snapshot WHERE watch_id = ?",
    ).bind(message.watch_id).first<{ n: number }>();
    const n = existing?.n ?? 0;
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count)
       VALUES (?, ?, '2026-09-22T12:00:00.000Z', 'no-upstream-call', 0)`,
    ).bind(`snap_${message.watch_id}_${n + 1}`, message.watch_id).run();
  }
  return messages;
}

async function xSnapshots(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n
     FROM snapshot s
     JOIN watch w ON w.id = s.watch_id
     WHERE w.source_id = ?`,
  ).bind(X_ID).first<{ n: number }>();
  return row?.n ?? 0;
}

async function pills(): Promise<Record<string, string | null>> {
  const selected = await env.DB.prepare(PILL).all<{ id: string; pill: string | null }>();
  const out: Record<string, string | null> = {};
  for (const row of selected.results ?? []) out[row.id] = row.pill;
  return out;
}

describe("disabled X source", () => {
  it("stays invisible until an UPDATE of is_enabled, which is what enqueues it", async () => {
    const row = await env.DB.prepare(
      `SELECT id, key, kind, platform, plugin_key, reliability, is_enabled, config_json
       FROM source WHERE id = ?`,
    ).bind(X_ID).first<{
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
    expect(row?.id).toBe(X_ID);
    expect(row?.key).toBe("x.apify");
    expect(row?.kind).toBe("mentions");
    expect(row?.platform).toBe("x");
    expect(row?.plugin_key).toBe("apify");
    expect(row?.reliability).toBe("best_effort");
    expect(row?.is_enabled).toBe(0);

    const config = JSON.parse(row?.config_json ?? "{}") as {
      reason: string;
      decision_on: string;
      cheapest_known_route: { provider: string; usd_per_1000_tweets: number; note: string };
      approved_cost: unknown;
    };
    expect(config.reason).toBe("Nish 2026-09-22: no paid X provider until revenue");
    expect(config.decision_on).toBe("2026-09-22");
    expect(config.cheapest_known_route.provider).toBe("Apify");
    expect(config.cheapest_known_route.usd_per_1000_tweets).toBe(0.4);
    expect(config.cheapest_known_route.note).toBe("roughly $0.40 per 1,000 tweets");
    expect(config.approved_cost).toBeNull();
    expect(Object.hasOwn(config, "approved_cost")).toBe(true);

    const costType = await env.DB.prepare(
      "SELECT json_type(config_json, '$.approved_cost') AS t FROM source WHERE id = ?",
    ).bind(X_ID).first<{ t: string }>();
    expect(costType?.t).toBe("null");

    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user_x_disabled', 'X disabled', 'x-disabled@example.com', 0, '2026-09-22', '2026-09-22')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, created_at)
       VALUES ('ws_x_disabled', 'X disabled', 'user_x_disabled', '2026-09-22T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES ('ent_x_disabled', 'ws_x_disabled', 'self', 'gymshark.com', 'Gymshark', 'on', '2026-09-22T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES ('src_test_hn', 'hn.algolia', 'mentions', 'hn', 'algolia', 'official_api', 1, '{}')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (
         'src_test_degraded',
         'test.degraded',
         'mentions',
         'test',
         'degraded',
         'rss',
         1,
         '{"degraded_reason":"not answering since 2026-09-21"}'
       )`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
         VALUES ('watch_x', 'ent_x_disabled', 'src_mentions_x', 'gymshark', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
         VALUES ('watch_hn', 'ent_x_disabled', 'src_test_hn', 'gymshark', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
         VALUES ('watch_degraded', 'ent_x_disabled', 'src_test_degraded', 'gymshark', 1)`,
      ),
    ]);

    const before = await pills();
    expect(before[X_ID]).toBeNull();
    expect(before.src_test_hn).toBe("live");
    expect(before.src_test_degraded).toBe("degraded");

    // A reason string on a disabled row is still not a degraded pill.
    await env.DB.prepare(
      `UPDATE source
       SET config_json = json_set(config_json, '$.degraded_reason', 'rate limited')
       WHERE id = ?`,
    ).bind(X_ID).run();
    const poisoned = await pills();
    expect(poisoned[X_ID]).toBeNull();
    expect(poisoned.src_test_degraded).toBe("degraded");

    await env.DB.prepare(
      `UPDATE source
       SET config_json = json_remove(config_json, '$.degraded_reason')
       WHERE id = ?`,
    ).bind(X_ID).run();
    const restored = await env.DB.prepare(
      "SELECT config_json, is_enabled FROM source WHERE id = ?",
    ).bind(X_ID).first<{ config_json: string; is_enabled: number }>();
    const restoredConfig = JSON.parse(restored?.config_json ?? "{}") as {
      reason: string;
      approved_cost: unknown;
      degraded_reason?: string;
    };
    expect(restored?.is_enabled).toBe(0);
    expect(restoredConfig.reason).toBe("Nish 2026-09-22: no paid X provider until revenue");
    expect(restoredConfig.approved_cost).toBeNull();
    expect(restoredConfig.degraded_reason).toBeUndefined();

    const disabledMessages = (await tick()).sort((a, b) => a.source_id.localeCompare(b.source_id));
    const disabledX = disabledMessages.filter((message) => message.source_id === X_ID);
    const disabledSnapshots = await xSnapshots();
    const disabledPills = await pills();
    console.log(`source_row_id=${X_ID}`);
    console.log(`tick_disabled=${JSON.stringify({ messages: disabledMessages, x_messages: disabledX, x_snapshots: disabledSnapshots, pills: disabledPills })}`);

    expect(disabledX).toEqual([]);
    expect(disabledSnapshots).toBe(0);
    expect(disabledMessages).toEqual([
      {
        watch_id: "watch_degraded",
        source_id: "src_test_degraded",
        entity_id: "ent_x_disabled",
        workspace_id: "ws_x_disabled",
      },
      {
        watch_id: "watch_hn",
        source_id: "src_test_hn",
        entity_id: "ent_x_disabled",
        workspace_id: "ws_x_disabled",
      },
    ]);
    expect(disabledPills[X_ID]).toBeNull();

    await env.DB.prepare(
      "UPDATE source SET is_enabled = 1 WHERE id = ?",
    ).bind(X_ID).run();

    const stillOne = await env.DB.prepare(
      "SELECT count(*) AS n FROM source WHERE platform = 'x' AND kind = 'mentions'",
    ).first<{ n: number }>();
    expect(stillOne?.n).toBe(1);

    const enabledMessages = (await tick()).sort((a, b) => a.source_id.localeCompare(b.source_id));
    const enabledX = enabledMessages.filter((message) => message.source_id === X_ID);
    const enabledSnapshots = await xSnapshots();
    const enabledPills = await pills();
    console.log(`tick_enabled=${JSON.stringify({ messages: enabledMessages, x_messages: enabledX, x_snapshots: enabledSnapshots, pills: enabledPills })}`);

    expect(enabledX).toEqual([
      {
        watch_id: "watch_x",
        source_id: X_ID,
        entity_id: "ent_x_disabled",
        workspace_id: "ws_x_disabled",
      },
    ]);
    expect(enabledSnapshots).toBe(1);
    expect(enabledPills[X_ID]).toBe("live");

    const after = await env.DB.prepare(
      "SELECT id, is_enabled, json_extract(config_json, '$.approved_cost') AS approved_cost FROM source WHERE id = ?",
    ).bind(X_ID).first<{ id: string; is_enabled: number; approved_cost: unknown }>();
    expect(after?.id).toBe(X_ID);
    expect(after?.is_enabled).toBe(1);
    expect(after?.approved_cost).toBeNull();
  });
});
