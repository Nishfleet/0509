import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { selectEligible } from "../../workers/mentions/tick";

describe("mentions source rows", () => {
  it("seeds seven sources and polls only an enabled watch", async () => {
    const sources = await env.DB.prepare(
      "SELECT plugin_key, is_enabled FROM source WHERE kind = 'mentions' ORDER BY plugin_key",
    ).all<{ plugin_key: string; is_enabled: number }>();
    const enabled = new Map((sources.results ?? []).map((row) => [row.plugin_key, row.is_enabled]));
    expect(enabled.get("hn.algolia")).toBe(1);
    expect(enabled.get("ddg.html")).toBe(0);
    expect(enabled.get("x.apify")).toBe(0);
    expect(enabled.size).toBe(7);

    const now = "2026-09-22T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-1', 'Ada', 'ada@example.com', 1, ?, ?)`,
    ).bind(now, now).run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES ('ws-1', 'Ada', 'user-1', ?)`,
    ).bind(now).run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
       VALUES ('ent-1', 'ws-1', 'self', 'example.com', 'Ada', 'on', ?)`,
    ).bind(now).run();
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('watch-x', 'ent-1', 'src_x_apify', 'ada')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('watch-hn', 'ent-1', 'src_hn_algolia', 'gymshark')`,
    ).run();

    const eligible = await selectEligible(env.DB);
    expect(eligible.map((row) => row.watchId)).toEqual(["watch-hn"]);

    await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = 'src_x_apify'").run();
    const after = await selectEligible(env.DB);
    expect(after.map((row) => row.watchId).sort()).toEqual(["watch-hn", "watch-x"]);
    expect(after.find((row) => row.watchId === "watch-x")?.rateClass).toBe("paced");
  });
});
