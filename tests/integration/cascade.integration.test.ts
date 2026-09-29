import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { deleteWorkspace } from "../../app/lib/data/workspace.server";

const NOW = "2026-09-25T00:00:00.000Z";

const INSERT_ORDER = [
  "plan",
  "entity",
  "suggestion",
  "discovery_backlog",
  "onboarding_run",
  "watch",
  "page",
  "snapshot",
  "signal",
  "jev_verdict",
  "user_decision",
  "incident",
  "incident_notice",
  "alert",
  "standing",
  "digest",
  "send_target",
  "send_attempt",
  "signal_delivery",
] as const;

const SEED: Readonly<Record<string, string>> = {
  plan: `INSERT INTO plan (id, workspace_id, updated_at) VALUES ('plan-cascade', 'ws-cascade', '${NOW}')`,
  entity: `INSERT INTO entity (id, workspace_id, role, domain, name, created_at)
    VALUES ('ent-cascade', 'ws-cascade', 'competitor', 'cascade.example', 'Cascade', '${NOW}')`,
  suggestion: `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, created_at)
    VALUES ('suggestion-cascade', 'ws-cascade', 'add', 'suggest.example', '${NOW}')`,
  discovery_backlog: `INSERT INTO discovery_backlog (workspace_id, name_key, name, evidence_json, evidence_count, first_seen_at, updated_at)
    VALUES ('ws-cascade', 'backlog.example', 'Backlog', '{}', 1, '${NOW}', '${NOW}')`,
  onboarding_run: `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at)
    VALUES ('onboarding-cascade', 'ws-cascade', 'user-cascade', 'cascade.example', '${NOW}')`,
  watch: `INSERT INTO watch (id, entity_id, source_id, target_key)
    VALUES ('watch-cascade', 'ent-cascade', 'src-cascade', 'cascade.example')`,
  page: `INSERT INTO page (id, entity_id, url, discovered_at)
    VALUES ('page-cascade', 'ent-cascade', 'https://cascade.example/', '${NOW}')`,
  snapshot: `INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash)
    VALUES ('snapshot-cascade', 'watch-cascade', '${NOW}', 'hash-cascade')`,
  signal: `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, dedup_key, observed_at)
    VALUES ('sig-cascade', 'ws-cascade', 'ent-cascade', 'src-cascade', 'change', 'pricing', 'dedup-cascade', '${NOW}')`,
  jev_verdict: `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, decided_at)
    VALUES ('jev-cascade', 'ws-cascade', 'mention_matters', 'ih-cascade', '${NOW}')`,
  user_decision: `INSERT INTO user_decision (id, workspace_id, user_id, verdict, decided_at)
    VALUES ('decision-cascade', 'ws-cascade', 'user-cascade', 'noteworthy', '${NOW}')`,
  incident: `INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at)
    VALUES ('inc-cascade', 'ws-cascade', 'ent-cascade', 'page-cascade', 'broken', '${NOW}')`,
  incident_notice: `INSERT INTO incident_notice (id, incident_id, page_id, sent_on, sent_at)
    VALUES ('notice-cascade', 'inc-cascade', 'page-cascade', '2026-09-25', '${NOW}')`,
  alert: `INSERT INTO alert (id, workspace_id, kind, title, created_at)
    VALUES ('alert-cascade', 'ws-cascade', 'takedown', 'Cascade alert', '${NOW}')`,
  standing: `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, computed_at)
    VALUES ('standing-cascade', 'ws-cascade', 'ent-cascade', '${NOW}', '${NOW}')`,
  digest: `INSERT INTO digest (id, workspace_id, period_start, period_end)
    VALUES ('digest-cascade', 'ws-cascade', '2026-09-18', '2026-09-25')`,
  send_target: `INSERT INTO send_target (id, workspace_id, channel_id, target_value, created_at)
    VALUES ('target-cascade', 'ws-cascade', 'chan-cascade', 'cascade@0509.io', '${NOW}')`,
  send_attempt: `INSERT INTO send_attempt (id, workspace_id, idempotency_key, status, attempted_at)
    VALUES ('attempt-cascade', 'ws-cascade', 'attempt-cascade', 'sent', '${NOW}')`,
  signal_delivery: `INSERT INTO signal_delivery (id, workspace_id, signal_id, channel_id, delivered_at)
    VALUES ('delivery-cascade', 'ws-cascade', 'sig-cascade', 'chan-cascade', '${NOW}')`,
};

async function seedParents(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES ('user-cascade', 'Owner', 'cascade@0509.io', 1, ?, ?)`,
  )
    .bind(NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES ('ws-cascade', 'Owner', 'user-cascade', 'UTC', 1, 8, ?)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES ('src-cascade', 'site.cascade', 'site', 'cascade', 'site.cascade', 'best_effort', 1, '{}')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-cascade', 'cascade', 1, '{}')`,
  ).run();
}

interface Edge {
  child: string;
  parent: string;
}

async function ownedTables(): Promise<string[]> {
  const { results: tables } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
        AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`,
  ).all<{ name: string }>();
  const edges: Edge[] = [];
  for (const { name } of tables ?? []) {
    const { results } = await env.DB.prepare(
      `SELECT "table" AS parent FROM pragma_foreign_key_list(?) WHERE on_delete = 'CASCADE'`,
    )
      .bind(name)
      .all<{ parent: string }>();
    for (const { parent } of results ?? []) {
      edges.push({ child: name, parent });
    }
  }
  const owned = new Set<string>(["workspace"]);
  for (let added = true; added; ) {
    added = false;
    for (const { child, parent } of edges) {
      if (owned.has(parent) && !owned.has(child)) {
        owned.add(child);
        added = true;
      }
    }
  }
  owned.delete("workspace");
  return [...owned].sort();
}

async function count(table: string): Promise<{ n: number }> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return { n: row?.n ?? 0 };
}

beforeEach(async () => {
  for (const table of [...INSERT_ORDER].reverse()) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  for (const table of ["workspace", "source", "channel", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("workspace cascade", () => {
  it("every owned table has a seed row", async () => {
    const owned = await ownedTables();
    const seeded = Object.keys(SEED);
    const missing = owned.filter((table) => !seeded.includes(table));
    expect(owned, `owned tables without a seed: ${missing.join(", ")}`).toEqual([...seeded].sort());
  });

  it("deleting a workspace removes every owned row", async () => {
    await seedParents();
    for (const table of INSERT_ORDER) {
      await env.DB.prepare(SEED[table]).run();
    }

    for (const table of INSERT_ORDER) {
      expect(await count(table), `${table} seed row missing before delete`).toEqual({ n: 1 });
    }

    await deleteWorkspace("ws-cascade");

    for (const table of INSERT_ORDER) {
      expect.soft(await count(table), `${table} rows survive the workspace cascade`).toEqual({ n: 0 });
    }
  });
});
