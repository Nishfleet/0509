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

  it("reclaims a pending change send older than the change stale window", async () => {
    const key = "change:sig-stale:tgt-change-claim";
    const stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
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

  it("reports a fresh pending change send as in flight so the queue retries it", async () => {
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

    expect(slot).toEqual({ kind: "in_flight" });
  });

  it("treats a sent change send as a duplicate", async () => {
    const key = "change:sig-sent:tgt-change-claim";
    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('att-sent', ?, ?, NULL, ?, 'sent', ?)`,
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

  it("drops only the exact signal when its id holds an underscore (0509#7084)", async () => {
    const insert = (id: string, key: string) =>
      env.DB.prepare(
        `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
         VALUES (?, ?, ?, NULL, ?, 'failed', ?)`,
      )
        .bind(id, WS, TARGET_ID, key, NOW)
        .run();
    await insert("att-under", "change:sig_a:tgt-change-claim");
    await insert("att-other", "change:sigXa:tgt-change-claim");

    await dropDeadLetteredChange(env.DB, "sig_a");

    const rows = await env.DB.prepare(`SELECT id, status FROM send_attempt ORDER BY id`).all<{
      id: string;
      status: string;
    }>();
    expect(rows.results).toEqual([
      { id: "att-other", status: "failed" },
      { id: "att-under", status: CHANGE_DEAD_LETTER_STATUS },
    ]);
  });
});
