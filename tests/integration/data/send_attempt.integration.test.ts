import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readUnrecordedSend } from "../../../app/lib/data/send_attempt.server";

const NOW = "2026-09-25T00:00:00Z";
const USER = "user-send-attempt-row";
const WORKSPACE = "ws-send-attempt-row";
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
  await env.DB.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
     VALUES (?, ?, 'weekly', '2026-09-18', '2026-09-25', ?, '{}')`,
  )
    .bind(DIGEST, WORKSPACE, digestStatus)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, error, attempted_at)
     VALUES (?, ?, NULL, ?, ?, ?, NULL, ?)`,
  )
    .bind(ATTEMPT, WORKSPACE, DIGEST, KEY, attemptStatus, NOW)
    .run();
};

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
