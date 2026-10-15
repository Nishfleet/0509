import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readEmailTarget, readEmailTargetByToken } from "../../../app/lib/data/send_target.server";
import { sha256Hex } from "../../../app/lib/sha256";

const NOW = "2026-09-25T00:00:00Z";
const EXPIRES = "2026-09-26T00:00:00Z";
const USER = "user-send-target-row";
const WORKSPACE = "ws-send-target-row";
const CHANNEL = "chan-email-send-target-row";
const TARGET = "st-send-target-row";
const ADDRESS = "owner@0509.io";
const TOKEN = "a".repeat(64);

const cleanTables = ["send_target", "channel", "workspace"];

const seedEmailTarget = async (verifyToken: string | null, verifyExpiresAt: string | null) => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(USER, ADDRESS, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Send target rows', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(WORKSPACE, USER, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`)
    .bind(CHANNEL)
    .run();
  await env.DB.prepare(
    `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, verify_token, verify_token_expires_at, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(TARGET, WORKSPACE, CHANNEL, ADDRESS, verifyToken, verifyExpiresAt, NOW)
    .run();
};

describe("send_target row readers (0509#7146)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
  });

  it("readEmailTarget returns the address and verification flag of the workspace's email target", async () => {
    await seedEmailTarget(null, null);

    expect(await readEmailTarget(env.DB, WORKSPACE)).toEqual({ target_value: ADDRESS, is_verified: 1 });
  });

  it("readEmailTarget returns null when the workspace has no email target", async () => {
    await seedEmailTarget(null, null);
    await env.DB.exec("DELETE FROM send_target");

    expect(await readEmailTarget(env.DB, WORKSPACE)).toBeNull();
  });

  it("readEmailTargetByToken resolves a target holding the hashed token before it expires", async () => {
    await seedEmailTarget(await sha256Hex(TOKEN), EXPIRES);

    expect(await readEmailTargetByToken(env.DB, { token: TOKEN, now: NOW })).toBe(ADDRESS);
  });

  it("readEmailTargetByToken returns null for an unknown token and for an expired one", async () => {
    await seedEmailTarget(await sha256Hex(TOKEN), EXPIRES);

    expect(await readEmailTargetByToken(env.DB, { token: "b".repeat(64), now: NOW })).toBeNull();
    expect(await readEmailTargetByToken(env.DB, { token: TOKEN, now: EXPIRES })).toBeNull();
  });
});
