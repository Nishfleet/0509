import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { refreshWorkspace } from "../../workers/standing/nightly";
import { SIGNAL_COUNT_SQL, STANDING_UPSERT_SQL, WEIGHTS_AS_OF_SQL } from "../../workers/standing/score";

const USER = "user-standing-3966";
const WS = "ws-standing-3966";

describe("standing schema", () => {
  it("seeds eleven weights and the signal index, then scores and upserts without touching rank", async () => {
    const weights = await env.DB.prepare("SELECT key, weight FROM scoring_weight ORDER BY key").all<{
      key: string;
      weight: number;
    }>();
    expect(weights.results).toHaveLength(11);
    expect(weights.results.find((row) => row.key === "mention_matters")?.weight).toBe(3);
    expect(weights.results.find((row) => row.key === "reliability_rss")?.weight).toBe(0.9);
    expect(weights.results.find((row) => row.key === "weights_version")?.weight).toBe(1);

    const index = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_ws_entity_time'",
    ).first<{ name: string }>();
    expect(index?.name).toBe("idx_signal_ws_entity_time");

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
      ).bind(USER, "Nish", "standing-3966@example.com", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES (?, 'Home', ?, 'UTC', 1, 8, '2026-09-01T00:00:00.000Z')`,
      ).bind(WS, USER),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES
         ('ent-self-3966', ?, 'self', 'self.example', 'Self', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-b-3966', ?, 'competitor', 'b.example', 'Kindred', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-c-3966', ?, 'competitor', 'c.example', 'Casetta', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-d-3966', ?, 'competitor', 'd.example', 'North', 'on', '2026-09-01T00:00:00.000Z')`,
      ).bind(WS, WS, WS, WS),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-standing-3966', 'news.standing_3966', 'mentions', 'standing-3966', 'rss', 'rss')`,
      ),
      env.DB.prepare(
        `INSERT INTO signal (
           id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at
         ) VALUES (
           'sig-standing-3966', ?, 'ent-self-3966', 'src-standing-3966', 'mention', 'https://example.com/a',
           'hash-standing-3966', 'dedup-standing-3966', '2026-09-22T11:00:00.000Z'
         )`,
      ).bind(WS),
      env.DB.prepare(
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, decided_at)
         VALUES ('v-standing-3966', ?, 'mention_matters', 'hash-standing-3966', 'sig-standing-3966', 'ent-self-3966', 0.95, '2026-09-22T12:00:00.000Z')`,
      ).bind(WS),
    ]);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SIGNAL_COUNT_SQL}`)
      .bind(WS, "ent-self-3966", "2026-09-21T08:00:00.000Z", "2026-09-22T12:00:00.000Z")
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_signal_ws_entity_time");
    expect(detail).not.toMatch(/SCAN (signal|s)\b/);

    const asOf = await env.DB.prepare(WEIGHTS_AS_OF_SQL)
      .bind("2026-09-21T08:00:00.000Z", "2026-09-21T08:00:00.000Z")
      .all<{ key: string; weight: number }>();
    expect(asOf.results.find((row) => row.key === "mention_matters")?.weight).toBe(3);

    await env.DB.prepare(
      "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES ('sw-later-3966', 'mention_matters', 9, '2026-10-01T00:00:00.000Z')",
    ).run();
    const during = await env.DB.prepare(WEIGHTS_AS_OF_SQL)
      .bind("2026-09-22T00:00:00.000Z", "2026-09-22T00:00:00.000Z")
      .all<{ key: string; weight: number }>();
    expect(during.results.find((row) => row.key === "mention_matters")?.weight).toBe(3);
    const later = await env.DB.prepare(WEIGHTS_AS_OF_SQL)
      .bind("2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z")
      .all<{ key: string; weight: number }>();
    expect(later.results.find((row) => row.key === "mention_matters")?.weight).toBe(9);
    await env.DB.prepare("DELETE FROM scoring_weight WHERE id = 'sw-later-3966'").run();

    const refreshed = await refreshWorkspace(
      env.DB,
      { id: WS, timezone: "UTC", briefWeekday: 1, briefHour: 8 },
      new Date("2026-09-22T12:00:00.000Z"),
    );
    expect(refreshed.weekStartAt).toBe("2026-09-21T08:00:00.000Z");
    const self = refreshed.scores.find((row) => row.entityId === "ent-self-3966");
    expect(self?.score).toBeCloseTo(2.7);
    const stored = await env.DB.prepare(
      "SELECT score, rank, movement, computed_at FROM standing WHERE workspace_id = ? AND entity_id = 'ent-self-3966'",
    )
      .bind(WS)
      .first<{ score: number; rank: number | null; movement: number | null; computed_at: string }>();
    expect(stored?.score).toBeCloseTo(2.7);
    expect(stored?.rank).toBeNull();
    expect(stored?.movement).toBeNull();
    expect(stored?.computed_at).toBe("2026-09-22T12:00:00.000Z");

    await env.DB.prepare(
      "UPDATE standing SET rank = 1, movement = 2 WHERE workspace_id = ? AND entity_id = 'ent-self-3966'",
    )
      .bind(WS)
      .run();
    await env.DB.prepare(STANDING_UPSERT_SQL)
      .bind("standing-again-3966", WS, "ent-self-3966", "2026-09-21T08:00:00.000Z", 9, "2026-09-22T13:00:00.000Z")
      .run();
    const frozen = await env.DB.prepare(
      "SELECT score, rank, movement FROM standing WHERE entity_id = 'ent-self-3966'",
    ).first<{ score: number; rank: number | null; movement: number | null }>();
    expect(frozen?.rank).toBe(1);
    expect(frozen?.movement).toBe(2);
    expect(frozen?.score).toBeCloseTo(2.7);
  });
});
