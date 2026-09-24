import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 0509#4707. Applies every migration except 0015, stores a connected set of
 * rows, then applies the rebuild. The rows must still read back, a matching
 * insert must succeed, and an insert that pairs another workspace's entity
 * must fail.
 */

const MIGRATION = "0015_entity_workspace_fk.sql";
const NOW = "2026-09-25T00:00:00.000Z";

const USER = "user-fk-4707";
const WS = "ws-fk-4707";
const WS_OTHER = "ws-fk-4707-b";
const ENTITY = "ent-fk-4707";
const ENTITY_OTHER = "ent-fk-4707-b";
const PAGE = "page-fk-4707";
const SOURCE = "src-fk-4707";
const WATCH = "watch-fk-4707";
const SNAP = "snap-fk-4707";
const SIGNAL = "sig-fk-4707";
const JEV = "jev-fk-4707";
const JEV_NULL = "jev-fk-4707-null";
const DECISION = "dec-fk-4707";
const DELIVERY = "del-fk-4707";
const ALERT = "alert-fk-4707";
const ALERT_NULL = "alert-fk-4707-null";
const INCIDENT = "inc-fk-4707";
const NOTICE = "notice-fk-4707";
const STANDING = "stand-fk-4707";

interface Migration {
  name: string;
  queries: string[];
}

const TABLES = [
  "signal",
  "incident",
  "alert",
  "standing",
  "jev_verdict",
  "user_decision",
  "signal_delivery",
  "incident_notice",
] as const;

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function entityFk(table: string): Promise<{ seq: number; from: string; to: string; on_delete: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT seq, "from", "to", on_delete FROM pragma_foreign_key_list('${table}') WHERE "table" = 'entity' ORDER BY id, seq`,
  ).all<{ seq: number; from: string; to: string; on_delete: string }>();
  return results ?? [];
}

describe("entity workspace foreign key (0509#4707)", () => {
  it("keeps stored rows and rejects a cross-workspace entity", async () => {
    const all = env.TEST_MIGRATIONS as Migration[];
    const next = all.filter((migration) => migration.name === MIGRATION);
    const prior = all.filter((migration) => migration.name !== MIGRATION);
    expect(next).toHaveLength(1);
    expect(prior).toHaveLength(all.length - 1);

    await applyD1Migrations(env.DB, prior);

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'fk-4707@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'FK', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'FK other', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS_OTHER, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', 'fk-4707.example', '{}', 'manual', 'on', ?)`,
    )
      .bind(ENTITY, WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', 'fk-4707-b.example', '{}', 'manual', 'on', ?)`,
    )
      .bind(ENTITY_OTHER, WS_OTHER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?, ?, 'https://fk-4707.example/', ?)`,
    )
      .bind(PAGE, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability)
       VALUES (?, 'fk-4707', 'mentions', 'test', 'fk-4707', 'best_effort')`,
    )
      .bind(SOURCE)
      .run();
    await env.DB.prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?, ?, ?, 'fk-4707.example')`,
    )
      .bind(WATCH, ENTITY, SOURCE)
      .run();
    await env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash) VALUES (?, ?, ?, 'hash-fk-4707')`,
    )
      .bind(SNAP, WATCH, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title,
                           canonical_url, url_hash, dedup_key, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'mention', 'Kept mention', 'https://fk-4707.example/m', 'hash-m', 'dedup-fk-4707', ?)`,
    )
      .bind(SIGNAL, WS, ENTITY, SOURCE, WATCH, SNAP, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
       VALUES (?, ?, 'mention_matters', 'ih-fk-4707', ?, ?, 0.95, 'kept', ?)`,
    )
      .bind(JEV, WS, SIGNAL, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, p, decided_at)
       VALUES (?, ?, 'mention_matters', 'ih-fk-4707-null', ?, 0.2, ?)`,
    )
      .bind(JEV_NULL, WS, SIGNAL, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, decided_at)
       VALUES (?, ?, ?, ?, ?, 'noteworthy', ?)`,
    )
      .bind(DECISION, WS, USER, SIGNAL, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, delivered_at)
       VALUES (?, ?, ?, 'chan-email', ?)`,
    )
      .bind(DELIVERY, WS, SIGNAL, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
       VALUES (?, ?, ?, ?, 'broken', ?)`,
    )
      .bind(INCIDENT, WS, ENTITY, PAGE, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution)
       VALUES (?, ?, ?, '2026-09-25', ?, 0)`,
    )
      .bind(NOTICE, INCIDENT, PAGE, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, entity_id, signal_id, incident_id, kind, title, created_at)
       VALUES (?, ?, ?, ?, ?, 'takedown', 'Kept alert', ?)`,
    )
      .bind(ALERT, WS, ENTITY, SIGNAL, INCIDENT, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, kind, title, created_at)
       VALUES (?, ?, 'delivery_failed', 'Kept null entity', ?)`,
    )
      .bind(ALERT_NULL, WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at)
       VALUES (?, ?, ?, ?, 12, 1, ?)`,
    )
      .bind(STANDING, WS, ENTITY, NOW, NOW)
      .run();

    const before = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])));

    await applyD1Migrations(env.DB, next);

    const after = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])));
    expect(after).toEqual(before);

    expect(
      await env.DB.prepare("SELECT title, workspace_id, entity_id FROM signal WHERE id = ?")
        .bind(SIGNAL)
        .first(),
    ).toEqual({ title: "Kept mention", workspace_id: WS, entity_id: ENTITY });
    expect(await env.DB.prepare("SELECT id FROM mention WHERE id = ?").bind(SIGNAL).first()).toEqual({
      id: SIGNAL,
    });
    expect(
      await env.DB.prepare("SELECT signal_id, entity_id, reason FROM jev_verdict WHERE id = ?")
        .bind(JEV)
        .first(),
    ).toEqual({ signal_id: SIGNAL, entity_id: ENTITY, reason: "kept" });
    expect(
      await env.DB.prepare("SELECT entity_id FROM jev_verdict WHERE id = ?").bind(JEV_NULL).first(),
    ).toEqual({ entity_id: null });
    expect(
      await env.DB.prepare("SELECT verdict, signal_id FROM user_decision WHERE id = ?").bind(DECISION).first(),
    ).toEqual({ verdict: "noteworthy", signal_id: SIGNAL });
    expect(
      await env.DB.prepare("SELECT signal_id FROM signal_delivery WHERE id = ?").bind(DELIVERY).first(),
    ).toEqual({ signal_id: SIGNAL });
    expect(
      await env.DB.prepare("SELECT title, entity_id, signal_id, incident_id FROM alert WHERE id = ?")
        .bind(ALERT)
        .first(),
    ).toEqual({ title: "Kept alert", entity_id: ENTITY, signal_id: SIGNAL, incident_id: INCIDENT });
    expect(
      await env.DB.prepare("SELECT title, entity_id FROM alert WHERE id = ?").bind(ALERT_NULL).first(),
    ).toEqual({ title: "Kept null entity", entity_id: null });
    expect(
      await env.DB.prepare("SELECT incident_id, is_resolution FROM incident_notice WHERE id = ?")
        .bind(NOTICE)
        .first(),
    ).toEqual({ incident_id: INCIDENT, is_resolution: 0 });
    expect(
      await env.DB.prepare("SELECT score, workspace_id, entity_id FROM standing WHERE id = ?")
        .bind(STANDING)
        .first(),
    ).toEqual({ score: 12, workspace_id: WS, entity_id: ENTITY });

    const tables = await env.DB.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' AND name NOT LIKE '_cf_%'",
    ).first<{ n: number }>();
    expect(tables?.n).toBe(34);
    const holds = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE '%_hold' OR name LIKE '\\_fk\\_%' ESCAPE '\\'",
    ).all<{ name: string }>();
    expect(holds.results ?? []).toEqual([]);

    const fk = [
      { seq: 0, from: "workspace_id", to: "workspace_id", on_delete: "CASCADE" },
      { seq: 1, from: "entity_id", to: "id", on_delete: "CASCADE" },
    ];
    for (const table of ["signal", "incident", "alert", "standing", "jev_verdict"]) {
      expect(await entityFk(table), table).toEqual(fk);
    }

    await env.DB.prepare(
      `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at)
       VALUES ('stand-fk-4707-ok', ?, ?, '2026-09-18T00:00:00.000Z', 1, ?)`,
    )
      .bind(WS, ENTITY, NOW)
      .run();
    expect(
      await env.DB.prepare("SELECT workspace_id, entity_id FROM standing WHERE id = 'stand-fk-4707-ok'").first(),
    ).toEqual({ workspace_id: WS, entity_id: ENTITY });

    await expect(
      env.DB.prepare(
        `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, computed_at)
         VALUES ('stand-fk-4707-bad', ?, ?, '2026-09-18T00:00:00.000Z', 1, ?)`,
      )
        .bind(WS_OTHER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(
      env.DB.prepare(
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, canonical_url, url_hash, dedup_key, observed_at)
         VALUES ('sig-fk-4707-bad', ?, ?, ?, 'mention', 'https://fk-4707.example/bad', 'hash-bad', 'dedup-fk-4707-bad', ?)`,
      )
        .bind(WS_OTHER, ENTITY, SOURCE, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES ('page-fk-4707-b', ?, 'https://fk-4707.example/b', ?)`,
    )
      .bind(ENTITY, NOW)
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
         VALUES ('inc-fk-4707-bad', ?, ?, 'page-fk-4707-b', 'broken', ?)`,
      )
        .bind(WS_OTHER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(
      env.DB.prepare(
        `INSERT INTO alert (id, workspace_id, entity_id, kind, title, created_at)
         VALUES ('alert-fk-4707-bad', ?, ?, 'takedown', 'Bad alert', ?)`,
      )
        .bind(WS_OTHER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await expect(
      env.DB.prepare(
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, entity_id, decided_at)
         VALUES ('jev-fk-4707-bad', ?, 'mention_matters', 'ih-fk-4707-bad', ?, ?)`,
      )
        .bind(WS_OTHER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, kind, title, created_at)
       VALUES ('alert-fk-4707-null-ok', ?, 'delivery_failed', 'Null entity still inserts', ?)`,
    )
      .bind(WS, NOW)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT workspace_id, entity_id FROM alert WHERE id = 'alert-fk-4707-null-ok'",
      ).first(),
    ).toEqual({ workspace_id: WS, entity_id: null });

    await env.DB.prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, decided_at)
       VALUES ('jev-fk-4707-null-ok', ?, 'mention_matters', 'ih-fk-4707-null-ok', ?)`,
    )
      .bind(WS, NOW)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT workspace_id, entity_id FROM jev_verdict WHERE id = 'jev-fk-4707-null-ok'",
      ).first(),
    ).toEqual({ workspace_id: WS, entity_id: null });
  });
});
