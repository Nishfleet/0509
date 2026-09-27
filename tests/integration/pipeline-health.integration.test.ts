import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { runPipelineHealth } from "../../app/lib/observability/pipeline-health.server";

const OWNER = "user-pipeline-health";
const WORKSPACE = "ws-pipeline-health";
const ENTITY = "ent-pipeline-health";
const SOURCE = "src-blind-test";
const WATCH = "watch-blind-test";
const NOW = new Date("2026-09-25T03:00:00Z");
const SEEDED_AT = "2026-09-24T00:00:00Z";

interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  status: string;
}

const blindAlerts = async (): Promise<AlertRow[]> =>
  (
    await env.DB.prepare(
      "SELECT id, kind, severity, title, body, status FROM alert WHERE workspace_id = ?1 AND kind = 'source_blind'",
    )
      .bind(WORKSPACE)
      .all<AlertRow>()
  ).results;

const degradedReason = async (): Promise<string | null> => {
  const row = await env.DB.prepare("SELECT degraded_reason FROM source WHERE id = ?1")
    .bind(SOURCE)
    .first<{ degraded_reason: string | null }>();
  if (row === null) throw new Error("seeded source row missing");
  return row.degraded_reason;
};

const insertSnapshot = (id: string, fetchedAt: string, itemCount: number): D1PreparedStatement =>
  env.DB.prepare(
    "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).bind(id, WATCH, fetchedAt, `hash-${id}`, itemCount);

describe("pipeline health source_blind alerts (0509#5301)", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM alert WHERE workspace_id = ?1").bind(WORKSPACE),
      env.DB.prepare("DELETE FROM snapshot WHERE watch_id = ?1").bind(WATCH),
      env.DB.prepare("DELETE FROM watch WHERE id = ?1").bind(WATCH),
      env.DB.prepare("DELETE FROM entity WHERE id = ?1").bind(ENTITY),
      env.DB.prepare("DELETE FROM source WHERE id = ?1").bind(SOURCE),
      env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WORKSPACE),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(OWNER),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
      ).bind(OWNER, "pipeline-health@0509.io", SEEDED_AT),
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Pipeline health', ?2, 'UTC', 1, 8, ?3)",
      ).bind(WORKSPACE, OWNER, SEEDED_AT),
      env.DB.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'self', ?3, 'Acme', ?4)",
      ).bind(ENTITY, WORKSPACE, "acme.example", SEEDED_AT),
      env.DB.prepare(
        "INSERT INTO source (id, key, kind, platform, plugin_key, is_enabled) VALUES (?1, 'gdelt.blind-test', 'mentions', 'gdelt', 'blind.test', 1)",
      ).bind(SOURCE),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?1, ?2, ?3, 'acme', 1)",
      ).bind(WATCH, ENTITY, SOURCE),
      insertSnapshot("snap-blind-1", "2026-09-25T01:00:00Z", 0),
      insertSnapshot("snap-blind-2", "2026-09-25T02:00:00Z", 0),
    ]);
  });

  it("writes one alert per watching workspace per UTC day and clears when the source captures again", async () => {
    const first = await runPipelineHealth(NOW);
    expect(first.blind).toBe(1);
    expect(first.alerts).toBe(1);
    expect(await degradedReason()).toBe("captured nothing for two ticks");

    const alerts = await blindAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe(`source-blind-${SOURCE}-${WORKSPACE}-2026-09-25`);
    expect(alerts[0]?.title).toContain("News");
    expect(alerts[0]?.severity).toBe("high");
    expect(alerts[0]?.status).toBe("unread");

    const again = await runPipelineHealth(NOW);
    expect(again.alerts).toBe(1);
    expect(await blindAlerts()).toHaveLength(1);

    await insertSnapshot("snap-blind-3", "2026-09-25T03:30:00Z", 4).run();
    const healed = await runPipelineHealth(NOW);
    expect(healed.blind).toBe(0);
    expect(healed.alerts).toBe(0);
    expect(await degradedReason()).toBeNull();
    expect(await blindAlerts()).toHaveLength(1);
  });
});
