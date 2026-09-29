import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { D1Migration } from "./entity-workspace-fk";

/**
 * 0509#4965. Applies every migration numbered before 0032, stores a connected
 * set of rows, then applies the rebuild. A later file must not run first.
 * A user_decision row that pairs another workspace's entity aborts the rebuild
 * before any table is dropped, and the stored rows are still there.
 * After that row is removed, the rebuild keeps every stored row, a null
 * entity_id still inserts on both tables, a cross-workspace insert fails on
 * both tables, and deleting an entity still clears suggestion.entity_id
 * (SET NULL) while cascading the user_decision row.
 */

const MIGRATION = "0032_user_decision_suggestion_workspace_fk.sql";
const PRIOR_LAST = "0031_send_target_verify_token.sql";
const NOW = "2026-09-30T00:00:00.000Z";

const USER = "user-fk-4965";
const WS = "ws-fk-4965";
const WS_OTHER = "ws-fk-4965-b";
const ENTITY = "ent-fk-4965";
const ENTITY_OTHER = "ent-fk-4965-b";
const DECISION = "dec-fk-4965";
const DECISION_NULL = "dec-fk-4965-null";
const SUGGESTION = "sug-fk-4965";
const SUGGESTION_NULL = "sug-fk-4965-null";

const TABLES = ["user_decision", "suggestion"] as const;

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

describe("entity workspace foreign key on user_decision and suggestion (0509#4965)", () => {
  it("keeps stored rows and rejects a cross-workspace entity", async () => {
    const all: D1Migration[] = env.TEST_MIGRATIONS;
    const next = all.filter((migration) => migration.name === MIGRATION);
    const prior = all
      .filter((migration) => migration.name < MIGRATION)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    expect(next).toHaveLength(1);
    expect(prior.at(-1)?.name).toBe(PRIOR_LAST);
    expect(prior.some((migration) => migration.name === MIGRATION)).toBe(false);

    await applyD1Migrations(env.DB, prior);
    const appliedPrior = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY name").all<{ name: string }>();
    expect((appliedPrior.results ?? []).map((row) => row.name)).toEqual(prior.map((migration) => migration.name));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'fk-4965@0509.io', 1, ?, ?)`,
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
       VALUES (?, ?, 'self', 'fk-4965.example', '{}', 'manual', 'on', ?)`,
    )
      .bind(ENTITY, WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', 'fk-4965-b.example', '{}', 'manual', 'on', ?)`,
    )
      .bind(ENTITY_OTHER, WS_OTHER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
       VALUES (?, ?, ?, ?, 'noteworthy', ?)`,
    )
      .bind(DECISION, WS, USER, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
       VALUES (?, ?, ?, NULL, 'noteworthy', ?)`,
    )
      .bind(DECISION_NULL, WS, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, candidate_name, status, created_at)
       VALUES (?, ?, ?, 'add', 'sug-fk-4965.example', 'Sug', 'pending', ?)`,
    )
      .bind(SUGGESTION, WS, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, status, created_at)
       VALUES (?, ?, NULL, 'add', 'sug-fk-4965-null.example', 'pending', ?)`,
    )
      .bind(SUGGESTION_NULL, WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
       VALUES ('dec-fk-4965-cross', ?, ?, ?, 'noteworthy', ?)`,
    )
      .bind(WS_OTHER, USER, ENTITY, NOW)
      .run();

    const seeded = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])));
    await expect(applyD1Migrations(env.DB, next)).rejects.toThrow(/CHECK constraint failed/);
    expect(Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])))).toEqual(
      seeded,
    );
    const leftover = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE '%_hold' OR name LIKE '\\_fk\\_%' ESCAPE '\\'",
    ).all<{ name: string }>();
    expect(leftover.results ?? []).toEqual([]);
    const recorded = await env.DB.prepare("SELECT name FROM d1_migrations WHERE name = ?").bind(MIGRATION).all();
    expect(recorded.results ?? []).toEqual([]);
    await env.DB.prepare("DELETE FROM user_decision WHERE id = 'dec-fk-4965-cross'").run();

    const before = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])));

    await applyD1Migrations(env.DB, next);

    const after = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(table)])));
    expect(after).toEqual(before);

    expect(
      await env.DB.prepare("SELECT verdict, workspace_id, entity_id FROM user_decision WHERE id = ?")
        .bind(DECISION)
        .first(),
    ).toEqual({ verdict: "noteworthy", workspace_id: WS, entity_id: ENTITY });
    expect(
      await env.DB.prepare("SELECT entity_id FROM user_decision WHERE id = ?").bind(DECISION_NULL).first(),
    ).toEqual({ entity_id: null });
    expect(
      await env.DB.prepare("SELECT status, workspace_id, entity_id FROM suggestion WHERE id = ?")
        .bind(SUGGESTION)
        .first(),
    ).toEqual({ status: "pending", workspace_id: WS, entity_id: ENTITY });
    expect(
      await env.DB.prepare("SELECT entity_id FROM suggestion WHERE id = ?").bind(SUGGESTION_NULL).first(),
    ).toEqual({ entity_id: null });

    const holds = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE '%_hold' OR name LIKE '\\_fk\\_%' ESCAPE '\\'",
    ).all<{ name: string }>();
    expect(holds.results ?? []).toEqual([]);

    expect(await entityFk("user_decision"), "user_decision").toEqual([
      { seq: 0, from: "workspace_id", to: "workspace_id", on_delete: "CASCADE" },
      { seq: 1, from: "entity_id", to: "id", on_delete: "CASCADE" },
    ]);
    expect(await entityFk("suggestion"), "suggestion").toEqual([
      { seq: 0, from: "workspace_id", to: "workspace_id", on_delete: "NO ACTION" },
      { seq: 1, from: "entity_id", to: "id", on_delete: "NO ACTION" },
      { seq: 0, from: "entity_id", to: "id", on_delete: "SET NULL" },
    ]);

    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
       VALUES ('dec-fk-4965-ok', ?, ?, ?, 'noteworthy', ?)`,
    )
      .bind(WS, USER, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
       VALUES ('dec-fk-4965-null-ok', ?, ?, NULL, 'noteworthy', ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, status, created_at)
       VALUES ('sug-fk-4965-ok', ?, ?, 'add', 'sug-fk-4965-ok.example', 'pending', ?)`,
    )
      .bind(WS, ENTITY, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, status, created_at)
       VALUES ('sug-fk-4965-null-ok', ?, NULL, 'add', 'sug-fk-4965-null-ok.example', 'pending', ?)`,
    )
      .bind(WS, NOW)
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, decided_at)
         VALUES ('dec-fk-4965-bad', ?, ?, ?, 'noteworthy', ?)`,
      )
        .bind(WS_OTHER, USER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await expect(
      env.DB.prepare(
        `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, status, created_at)
         VALUES ('sug-fk-4965-bad', ?, ?, 'add', 'sug-fk-4965-bad.example', 'pending', ?)`,
      )
        .bind(WS_OTHER, ENTITY, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);

    // suggestion keeps SET NULL and user_decision keeps CASCADE on entity
    // delete: the suggestion row survives with entity_id cleared, the
    // decision row is gone — the same actions the bare entity_id keys had.
    await env.DB.prepare("DELETE FROM entity WHERE id = ?").bind(ENTITY).run();
    expect(
      await env.DB.prepare("SELECT workspace_id, entity_id, status FROM suggestion WHERE id = ?")
        .bind(SUGGESTION)
        .first(),
    ).toEqual({ workspace_id: WS, entity_id: null, status: "pending" });
    expect(await env.DB.prepare("SELECT id FROM user_decision WHERE id = ?").bind(DECISION).first()).toBeNull();

    // The takedown trigger is rebuilt with the table: a suggestion for a
    // taken-down domain is silently ignored.
    await env.DB.prepare(
      "INSERT INTO takedown (subject, requested_at, actioned_at, actioned_by) VALUES ('blocked-fk-4965.example', ?, ?, 'test')",
    )
      .bind(NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, status, created_at)
       VALUES ('sug-fk-4965-blocked', ?, 'add', 'blocked-fk-4965.example', 'pending', ?)`,
    )
      .bind(WS, NOW)
      .run();
    expect(
      await env.DB.prepare("SELECT id FROM suggestion WHERE id = 'sug-fk-4965-blocked'").first(),
    ).toBeNull();
  });
});
