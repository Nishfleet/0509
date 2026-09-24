import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readDeliveryAddress, saveDeliveryAddress } from "../../app/lib/delivery-address.server";
import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";

const USER_ID = "user-da";
const SIGN_IN_EMAIL = "owner@0509.io";
const NOW = "2026-09-24T00:00:00Z";

interface TargetRow {
  workspace_id: string;
  target_value: string;
  is_verified: number;
  unsubscribe_token: string | null;
}

const allTargets = async (workspaceId: string): Promise<TargetRow[]> =>
  (
    await env.DB.prepare(
      `SELECT workspace_id, target_value, is_verified, unsubscribe_token
         FROM send_target
        WHERE workspace_id = ?
        ORDER BY target_value ASC`,
    )
      .bind(workspaceId)
      .all<TargetRow>()
  ).results ?? [];

const tripwireRows = async (): Promise<unknown[]> =>
  (
    await env.DB.prepare(
      `SELECT workspace_id, channel_id, COUNT(*) AS targets
         FROM send_target
        GROUP BY workspace_id, channel_id
       HAVING COUNT(*) > 1`,
    ).all()
  ).results ?? [];

interface SuppressionRow {
  address: string;
  reason: string;
}

const suppressionRow = async (address: string): Promise<SuppressionRow | null> =>
  env.DB.prepare(
    `SELECT address, reason FROM email_suppression WHERE address = ?`,
  )
    .bind(address)
    .first<SuppressionRow>();

describe("change the workspace's email address (0509#4779)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM email_suppression");
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
      .bind(USER_ID, SIGN_IN_EMAIL, NOW, NOW)
      .run();
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });
    await env.DB.prepare(
      `UPDATE send_target SET unsubscribe_token = 'old-token' WHERE workspace_id = ?`,
    )
      .bind(firstWorkspaceId(USER_ID))
      .run();
  });

  it("(a) changes the address, clears verification, rotates the token; second change replaces in place; tripwire stays clean", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);

    const first = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: " new@0509.io ",
      resume: false,
    });
    expect(first).toEqual({ error: null, suppressed: false });

    const afterFirst = await allTargets(workspaceId);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      target_value: "new@0509.io",
      is_verified: 0,
      unsubscribe_token: null,
    });

    const second = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "other@0509.io",
      resume: false,
    });
    expect(second).toEqual({ error: null, suppressed: false });

    const afterSecond = await allTargets(workspaceId);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.target_value).toBe("other@0509.io");
    expect(await tripwireRows()).toEqual([]);
  });

  it("(b) saving the current address leaves verification and the token alone", async () => {
    const before = await allTargets(firstWorkspaceId(USER_ID));
    expect(before[0]).toMatchObject({
      target_value: SIGN_IN_EMAIL,
      is_verified: 1,
      unsubscribe_token: "old-token",
    });

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: SIGN_IN_EMAIL,
      resume: false,
    });
    expect(result).toEqual({ error: null, suppressed: false });

    const after = await allTargets(firstWorkspaceId(USER_ID));
    expect(after[0]).toMatchObject({
      target_value: SIGN_IN_EMAIL,
      is_verified: 1,
      unsubscribe_token: "old-token",
    });
  });

  it("(c) refuses a suppressed address by default; resume clears the suppression and updates the target", async () => {
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES ('gone@0509.io', 'unsubscribed', ?)`,
    )
      .bind(NOW)
      .run();

    const blocked = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "gone@0509.io",
      resume: false,
    });
    expect(blocked.error).not.toBeNull();
    expect(blocked.suppressed).toBe(true);

    const unchanged = await allTargets(firstWorkspaceId(USER_ID));
    expect(unchanged[0]?.target_value).toBe(SIGN_IN_EMAIL);
    const stillSuppressed = await suppressionRow("gone@0509.io");
    expect(stillSuppressed).not.toBeNull();

    const resumed = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "gone@0509.io",
      resume: true,
    });
    expect(resumed).toEqual({ error: null, suppressed: false });

    expect(await suppressionRow("gone@0509.io")).toBeNull();
    const updated = await allTargets(firstWorkspaceId(USER_ID));
    expect(updated[0]?.target_value).toBe("gone@0509.io");
  });

  it("(d) rejects an address with no @", async () => {
    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "not-an-address",
      resume: false,
    });
    expect(result.error).not.toBeNull();
    expect(result.suppressed).toBe(false);

    const rows = await allTargets(firstWorkspaceId(USER_ID));
    expect(rows[0]?.target_value).toBe(SIGN_IN_EMAIL);
    expect(rows[0]?.is_verified).toBe(1);
    expect(rows[0]?.unsubscribe_token).toBe("old-token");
  });

  it("(e) creates the one target when none exists and the workspace has no email row yet", async () => {
    await env.DB.exec("DELETE FROM send_target");

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "new@0509.io",
      resume: false,
    });
    expect(result).toEqual({ error: null, suppressed: false });

    const rows = await allTargets(firstWorkspaceId(USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_value).toBe("new@0509.io");
  });

  it("readDeliveryAddress returns the stored target, falling back to sign-in email for a workspace with no target", async () => {
    await env.DB.exec("DELETE FROM send_target");

    const beforeStored = await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL);
    expect(beforeStored).toBe(SIGN_IN_EMAIL);

    await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "new@0509.io",
      resume: false,
    });

    const afterStored = await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL);
    expect(afterStored).toBe("new@0509.io");
  });
});
