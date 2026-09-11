import { describe, expect, it } from "vitest";

import { listActiveSourceTargetsForPolling } from "~/lib/presence-data.server";
import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #2461 — scheduled presence polling must not hardcode
 * `connector_id = 'website'`. The batch poller
 * (`runPresencePollingBatch`) already gates every row through
 * `connectorOperationalForPolling`, so the feeder query must return every
 * active target and let the per-connector rollout gate decide eligibility.
 * Repro from the finding: seed an active `source_target` with
 * `connector_id = 'x'` and assert the feeder returns it; also assert the
 * `'rss'` connector id passes the widened `source_target` CHECK (migration
 * 0093) on INSERT.
 */
async function seedSourceTarget(userId: string, connectorId: string, targetId = uid("st")) {
  const entityId = uid("te");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, is_active, created_at, updated_at)
       VALUES (?, ?, 'competitor', 'Fixture entity', 1, ?, ?)`,
    )
    .bind(entityId, userId, ISO_T0, ISO_T0)
    .run();
  await db()
    .prepare(
      `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(targetId, entityId, userId, connectorId, `key_${targetId}`, ISO_T0, ISO_T0)
    .run();
  return targetId;
}

describe("listActiveSourceTargetsForPolling — all active connectors (issue #2461)", () => {
  it("returns an active 'x' source_target, not just website rows", async () => {
    const userId = await seedUser(uid("user"));
    const xTargetId = await seedSourceTarget(userId, "x");

    const targets = await listActiveSourceTargetsForPolling(appEnv, 20);
    expect(targets.some((t) => t.id === xTargetId && t.connectorId === "x")).toBe(true);
  });

  it("accepts an 'rss' source_target row (widened CHECK, migration 0093)", async () => {
    const userId = await seedUser(uid("user"));
    const rssTargetId = await seedSourceTarget(userId, "rss");

    const targets = await listActiveSourceTargetsForPolling(appEnv, 20);
    expect(targets.some((t) => t.id === rssTargetId && t.connectorId === "rss")).toBe(true);
  });

  it("still excludes soft-deleted and inactive targets", async () => {
    const userId = await seedUser(uid("user"));
    const deletedId = await seedSourceTarget(userId, "x", uid("st"));
    await db()
      .prepare(`UPDATE source_target SET deleted_at = ?, is_active = 0 WHERE id = ?`)
      .bind(ISO_T0, deletedId)
      .run();

    const targets = await listActiveSourceTargetsForPolling(appEnv, 20);
    expect(targets.some((t) => t.id === deletedId)).toBe(false);
  });
});
