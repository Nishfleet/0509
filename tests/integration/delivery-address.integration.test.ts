import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";

const USER_ID = "user-da";
const EMAIL = "owner@0509.io";
const NOW = "2026-09-24T00:00:00Z";

interface TargetRow {
  channel_id: string;
  target_value: string;
  is_verified: number;
  channel_key: string;
}

const emailTargets = async (workspaceId: string): Promise<TargetRow[]> =>
  (
    await env.DB.prepare(
      `SELECT st.channel_id, st.target_value, st.is_verified, c.key AS channel_key
         FROM send_target st
         JOIN channel c ON c.id = st.channel_id
        WHERE st.workspace_id = ?`,
    )
      .bind(workspaceId)
      .all<TargetRow>()
  ).results ?? [];

const channelCount = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM channel").first<{ n: number }>())?.n ?? -1;

const tripwireRows = async (): Promise<unknown[]> =>
  (
    await env.DB.prepare(
      `SELECT workspace_id, channel_id, COUNT(*) AS targets
         FROM send_target
        GROUP BY workspace_id, channel_id
       HAVING COUNT(*) > 1`,
    ).all()
  ).results ?? [];

describe("delivery address on sign-in (0509#4776)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', ?, 1, ?, ?)`,
    )
      .bind(USER_ID, EMAIL, NOW, NOW)
      .run();
  });

  it("(a) creates one verified email target holding the sign-in email", async () => {
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });

    const rows = await emailTargets(firstWorkspaceId(USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target_value: EMAIL,
      is_verified: 1,
      channel_key: "email",
    });
  });

  it("(b) three sign-ins leave one target and clear the tripwire", async () => {
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });

    expect(await emailTargets(firstWorkspaceId(USER_ID))).toHaveLength(1);
    expect(await tripwireRows()).toEqual([]);
  });

  it("(c) reuses the channel that already holds the email key", async () => {
    await env.DB.exec("DELETE FROM channel");
    await env.DB.prepare(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-pre', 'email', 1, '{}')`,
    ).run();

    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });

    const rows = await emailTargets(firstWorkspaceId(USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel_id).toBe("chan-pre");
    expect(await channelCount()).toBe(1);
  });
});
