import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { refreshWorkspace } from "../../workers/standing/nightly";
import { SIGNAL_COUNT_SQL, STANDING_UPSERT_SQL, WEIGHTS_AS_OF_SQL } from "../../workers/standing/score";

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
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      ).bind("user-1", "Nish", "nish@example.com", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
         VALUES ('ws-1', 'Home', 'user-1', 'UTC', 1, 8, '2026-09-01T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES
         ('ent-self', 'ws-1', 'self', 'self.example', 'Self', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-b', 'ws-1', 'competitor', 'b.example', 'Kindred', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-c', 'ws-1', 'competitor', 'c.example', 'Casetta', 'on', '2026-09-01T00:00:00.000Z'),
         ('ent-d', 'ws-1', 'competitor', 'd.example', 'North', 'on', '2026-09-01T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
         VALUES ('src-1', 'news.google_rss', 'mentions', 'google', 'rss', 'rss')`,
      ),
      env.DB.prepare(
        `INSERT INTO signal (
           id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at
         ) VALUES (
           'sig-1', 'ws-1', 'ent-self', 'src-1', 'mention', 'https://example.com/a', 'hash-a', 'dedup-a',
           '2026-09-22T11:00:00.000Z'
         )`,
      ),
      env.DB.prepare(
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, decided_at)
         VALUES ('v-1', 'ws-1', 'mention_matters', 'hash-1', 'sig-1', 'ent-self', 0.95, '2026-09-22T12:00:00.000Z')`,
      ),
    ]);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${SIGNAL_COUNT_SQL}`).bind(
      "ws-1",
      "ent-self",
      "2026-09-21T08:00:00.000Z",
      "2026-09-22T12:00:00.000Z",
    ).all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_signal_ws_entity_time");
    expect(detail).not.toMatch(/SCAN (signal|s)\b/);

    const asOf = await env.DB.prepare(WEIGHTS_AS_OF_SQL).bind(
      "2026-09-21T08:00:00.000Z",
      "2026-09-21T08:00:00.000Z",
    ).all<{ key: string; weight: number }>();
    expect(asOf.results.find((row) => row.key === "mention_matters")?.weight).toBe(3);

    await env.DB.prepare(
      "INSERT INTO scoring_weight (id, key, weight, effective_from) VALUES ('sw-later', 'mention_matters', 9, '2026-10-01T00:00:00.000Z')",
    ).run();
    const during = await env.DB.prepare(WEIGHTS_AS_OF_SQL).bind(
      "2026-09-22T00:00:00.000Z",
      "2026-09-22T00:00:00.000Z",
    ).all<{ key: string; weight: number }>();
    expect(during.results.find((row) => row.key === "mention_matters")?.weight).toBe(3);
    const later = await env.DB.prepare(WEIGHTS_AS_OF_SQL).bind(
      "2026-10-02T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
    ).all<{ key: string; weight: number }>();
    expect(later.results.find((row) => row.key === "mention_matters")?.weight).toBe(9);

    const refreshed = await refreshWorkspace(env.DB, {
      id: "ws-1",
      timezone: "UTC",
      briefWeekday: 1,
      briefHour: 8,
    }, new Date("2026-09-22T12:00:00.000Z"));
    expect(refreshed.weekStartAt).toBe("2026-09-21T08:00:00.000Z");
    const self = refreshed.scores.find((row) => row.entityId === "ent-self");
    expect(self?.score).toBeCloseTo(2.7);
    const stored = await env.DB.prepare(
      "SELECT score, rank, movement FROM standing WHERE workspace_id = 'ws-1' AND entity_id = 'ent-self'",
    ).first<{ score: number; rank: number | null; movement: number | null }>();
    expect(stored?.score).toBeCloseTo(2.7);
    expect(stored?.rank).toBeNull();
    expect(stored?.movement).toBeNull();

    await env.DB.prepare(
      "UPDATE standing SET rank = 1, movement = 2 WHERE workspace_id = 'ws-1' AND entity_id = 'ent-self'",
    ).run();
    await env.DB.prepare(STANDING_UPSERT_SQL).bind(
      "standing-again",
      "ws-1",
      "ent-self",
      "2026-09-21T08:00:00.000Z",
      9,
      "2026-09-22T13:00:00.000Z",
    ).run();
    const frozen = await env.DB.prepare(
      "SELECT score, rank, movement FROM standing WHERE entity_id = 'ent-self'",
    ).first<{ score: number; rank: number | null; movement: number | null }>();
    expect(frozen?.rank).toBe(1);
    expect(frozen?.movement).toBe(2);
    expect(frozen?.score).toBeCloseTo(2.7);
  });
});
