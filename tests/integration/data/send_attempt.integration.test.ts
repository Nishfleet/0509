import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimChangeSlot,
  claimSendAttempt,
  readUnrecordedSend,
  resolveSendAttempt,
} from "../../../app/lib/data/send_attempt.server";

const NOW = "2026-09-25T00:00:00Z";
const SINCE = "2026-09-01T00:00:00Z";
const USER = "user-send-attempt-row";
const WORKSPACE = "ws-send-attempt-row";
const CHANNEL = "chan-email-send-attempt-row";
const TARGET = "st-send-attempt-row";
const DIGEST = "digest-send-attempt-row";
const ATTEMPT = "attempt-send-attempt-row";
const KEY = "digest:ws-send-attempt-row:2026-09-25";

const cleanTables = ["send_attempt", "digest", "send_target", "channel", "workspace"];

const seed = async (digestStatus: string, attemptStatus: string) => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', 'send-attempt-row@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Send attempt rows', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WORKSPACE, USER, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`)
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
     VALUES (?, ?, ?, 'owner@0509.io', 1, ?)`,
  )
    .bind(TARGET, WORKSPACE, CHANNEL, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
     VALUES (?, ?, 'weekly', '2026-09-18', '2026-09-25', ?, '{}')`,
  )
    .bind(DIGEST, WORKSPACE, digestStatus)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, error, attempted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(ATTEMPT, WORKSPACE, TARGET, DIGEST, KEY, attemptStatus, NOW)
    .run();
};

const attemptStatusFor = async (id: string) =>
  (await env.DB.prepare(`SELECT status FROM send_attempt WHERE id = ?`).bind(id).first<{ status: string }>())?.status ??
  null;

describe("send_attempt row readers (0509#7146)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
  });

  it("readUnrecordedSend returns the attempt id for a sent attempt whose digest is not sent", async () => {
    await seed("pending", "sent");

    expect(await readUnrecordedSend(env.DB, KEY)).toEqual({ id: ATTEMPT });
  });

  it("readUnrecordedSend returns null when the linked digest is already sent", async () => {
    await seed("sent", "sent");

    expect(await readUnrecordedSend(env.DB, KEY)).toBeNull();
  });

  it("readUnrecordedSend returns null when the attempt is not sent yet", async () => {
    await seed("pending", "pending");

    expect(await readUnrecordedSend(env.DB, KEY)).toBeNull();
  });

  it("readUnrecordedSend returns null for an unknown idempotency key", async () => {
    await seed("pending", "sent");

    expect(await readUnrecordedSend(env.DB, "digest:missing:2026-09-25")).toBeNull();
  });
});

describe("send_attempt claim readers (0509#7146)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
  });

  it("claimSendAttempt claims a fresh key, refuses a live one, and re-claims a failed one", async () => {
    await seed("pending", "pending");
    await env.DB.exec("DELETE FROM send_attempt");
    const input = { idempotencyKey: KEY, workspaceId: WORKSPACE, targetId: TARGET, digestId: null };

    const claimed = await claimSendAttempt(env.DB, input);
    expect(claimed).not.toBeNull();
    expect(await attemptStatusFor(claimed?.id ?? "")).toBe("pending");

    expect(await claimSendAttempt(env.DB, input)).toBeNull();

    await resolveSendAttempt(env.DB, { attemptId: claimed?.id ?? "", outcome: "failed", error: "smtp 550" });
    expect(await claimSendAttempt(env.DB, input)).toEqual({ id: claimed?.id });
  });

  it("claimChangeSlot reports claimed, duplicate, then capped", async () => {
    await seed("pending", "pending");
    await env.DB.exec("DELETE FROM send_attempt");
    const base = { workspaceId: WORKSPACE, targetId: TARGET, since: SINCE, cap: 1 };

    const claimed = await claimChangeSlot(env.DB, { ...base, idempotencyKey: "change:row:1" });
    expect(claimed.kind).toBe("claimed");

    const duplicate = await claimChangeSlot(env.DB, { ...base, idempotencyKey: "change:row:1" });
    expect(duplicate).toEqual({ kind: "duplicate" });

    const capped = await claimChangeSlot(env.DB, { ...base, idempotencyKey: "change:row:2" });
    expect(capped).toEqual({ kind: "capped" });
  });
});
