import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { planTargets } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T03:00:00.000Z";

let runs = 0;

async function seedPacedSource(configJson: string): Promise<{ sourceId: string; brand: string }> {
  runs += 1;
  const workspaceId = `ws-pace-${String(runs)}`;
  const userId = `user-pace-${String(runs)}`;
  const brand = `Pacewear ${String(runs)}`;
  const entityId = `${workspaceId}-competitor`;
  const sourceId = `src_pace_test_${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5)",
    ).bind(entityId, workspaceId, `pacewear-${String(runs)}.com`, brand, NOW),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES (?1, ?2, 'mentions', ?3, 'gdelt.doc', 'official_api', 1, ?4)`,
    ).bind(sourceId, `pace.test.${String(runs)}`, `pace_${String(runs)}`, configJson),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, ?3, ?4)",
    ).bind(`w_pace_${String(runs)}`, entityId, sourceId, brand),
  ]);
  return { sourceId, brand };
}

async function targetFor(brand: string, sourceId: string) {
  const target = (await planTargets()).find(
    (entry) => entry.query === brand && entry.sourceId === sourceId,
  );
  if (target === undefined) throw new Error(`no mentions target for ${brand} under ${sourceId}`);
  return target;
}

describe("mentions pacing reads min_interval_seconds off the source row", () => {
  it("planTargets carries the row's min_interval_seconds onto the target", async () => {
    const { sourceId, brand } = await seedPacedSource('{"min_interval_seconds":9}');

    const target = await targetFor(brand, sourceId);

    expect(target.sourceId).toBe(sourceId);
    expect(target.minIntervalSeconds).toBe(9);
  });

  it("a source row without min_interval_seconds paces at zero", async () => {
    const { sourceId, brand } = await seedPacedSource("{}");

    const target = await targetFor(brand, sourceId);

    expect(target.minIntervalSeconds).toBe(0);
  });
});
