import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CHANGE_DEAD_LETTER_STATUS,
  claimChangeSlot,
  dropDeadLetteredChange,
} from "../../app/lib/data/send_attempt.server";

const WS = "ws-change-claim";
const CHANNEL = "chan-change-claim";
const TARGET_ID = "tgt-change-claim";
const NOW = "2026-10-05T12:00:00.000Z";

describe("claimChangeSlot (0509#7084)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_attempt");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('user-change-claim', 'Reader', 'reader@0509.io', 1, ?, ?)`,
    )
      .bind(NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Change claim', 'user-change-claim', 'UTC', 1, 8, ?)`,
    )
      .bind(WS, NOW)
      .run();
    await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`)
      .bind(CHANNEL)
      .run();
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES (?, ?, ?, 'reader@0509.io', 1, ?)`,
    )
      .bind(TARGET_ID, WS, CHANNEL, NOW)
      .run();
  });

  it("reclaims a pending change send older than one hour", async () => {
    const key = "change:sig-stale:tgt-change-claim";
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('att-stale', ?, ?, NULL, ?, 'pending', ?)`,
    )
      .bind(WS, TARGET_ID, key, stale)
      .run();

    const slot = await claimChangeSlot(env.DB, {
      idempotencyKey: key,
      workspaceId: WS,
      targetId: TARGET_ID,
      since: "2026-10-05T00:00:00.000Z",
      cap: 5,
    });

    expect(slot.kind).toBe("claimed");
  });

  it("treats a fresh pending change send as a duplicate", async () => {
    const key = "change:sig-fresh:tgt-change-claim";
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('att-fresh', ?, ?, NULL, ?, 'pending', ?)`,
    )
      .bind(WS, TARGET_ID, key, new Date().toISOString())
      .run();

    const slot = await claimChangeSlot(env.DB, {
      idempotencyKey: key,
      workspaceId: WS,
      targetId: TARGET_ID,
      since: "2026-10-05T00:00:00.000Z",
      cap: 5,
    });

    expect(slot).toEqual({ kind: "duplicate" });
  });

  it("does not reclaim a change send the dead-letter queue already dropped (0509#7084)", async () => {
    const key = "change:sig-dropped:tgt-change-claim";
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('att-dropped', ?, ?, NULL, ?, 'failed', ?)`,
    )
      .bind(WS, TARGET_ID, key, NOW)
      .run();

    await dropDeadLetteredChange(env.DB, "sig-dropped");

    const slot = await claimChangeSlot(env.DB, {
      idempotencyKey: key,
      workspaceId: WS,
      targetId: TARGET_ID,
      since: "2026-10-05T00:00:00.000Z",
      cap: 5,
    });

    expect(slot).toEqual({ kind: "duplicate" });
    const row = await env.DB.prepare(`SELECT status FROM send_attempt WHERE id = 'att-dropped'`).first<{
      status: string;
    }>();
    expect(row?.status).toBe(CHANGE_DEAD_LETTER_STATUS);
  });
});
