import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { isAddressSuppressed, suppressByUnsubscribeToken } from "../../app/lib/data/email_suppression.server";
import { saveDeliveryAddress } from "../../app/lib/delivery-address.server";
import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";

let USER_ID = "user-case";
const NOW = "2026-10-05T00:00:00Z";

const silentBinding = (sent: unknown[]): SendEmail => ({
  send(message: EmailMessage | EmailMessageBuilder) {
    sent.push(message);
    return Promise.resolve({ messageId: "test-message" });
  },
});

const suppress = async (address: string): Promise<void> => {
  await env.DB.prepare(`INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', ?)`)
    .bind(address, NOW)
    .run();
};

const suppressionAddresses = async (): Promise<string[]> =>
  (
    (await env.DB.prepare(`SELECT address FROM email_suppression ORDER BY address`).all<{ address: string }>())
      .results ?? []
  ).map((row) => row.address);

const emailTarget = async (workspaceId: string): Promise<{ target_value: string; is_verified: number } | null> =>
  env.DB.prepare(
    `SELECT st.target_value, st.is_verified FROM send_target st
       JOIN channel c ON c.id = st.channel_id
      WHERE st.workspace_id = ? AND c.key = 'email'`,
  )
    .bind(workspaceId)
    .first<{ target_value: string; is_verified: number }>();

const seedOwner = async (signInEmail: string): Promise<string> => {
  USER_ID = `user-case-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(USER_ID, signInEmail, NOW, NOW)
    .run();
  await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });
  return firstWorkspaceId(USER_ID);
};

describe("email suppression ignores address case (2026-10-05 suppression case bypass)", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`,
    ).run();
  });

  it("refuses an unsubscribed address saved again with different capitals", async () => {
    await seedOwner("owner@0509.io");
    await suppress("gone@0509.io");

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: "owner@0509.io",
      email: silentBinding([]),
      address: "  Gone@0509.IO ",
      resume: false,
    });

    expect(result.suppressed).toBe(true);
    expect(await suppressionAddresses()).toEqual(["gone@0509.io"]);
  });

  it("finds a stored mixed-case suppression from any casing of the address", async () => {
    await suppress("Legacy@0509.io");

    expect(await isAddressSuppressed("legacy@0509.io")).toBe(true);
    expect(await isAddressSuppressed(" LEGACY@0509.IO ")).toBe(true);
    expect(await isAddressSuppressed("other@0509.io")).toBe(false);
  });

  it("stores the send target trimmed and lowercased", async () => {
    const workspaceId = await seedOwner("owner@0509.io");

    await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: "owner@0509.io",
      email: silentBinding([]),
      address: " New@0509.IO ",
      resume: false,
    });

    expect((await emailTarget(workspaceId))?.target_value).toBe("new@0509.io");
  });

  it("an unsubscribe from a mixed-case target stores the normalized address", async () => {
    const workspaceId = await seedOwner("owner@0509.io");
    await env.DB.prepare(
      `UPDATE send_target SET target_value = 'Mixed@0509.io', unsubscribe_token = 'tok' WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .run();

    await suppressByUnsubscribeToken("tok");

    expect(await suppressionAddresses()).toEqual(["mixed@0509.io"]);
  });

  it("resume on the signed-in address clears the suppression whatever the casing on either side", async () => {
    const workspaceId = await seedOwner("Owner@0509.io");
    await suppress("OWNER@0509.io");
    const sent: unknown[] = [];

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: "Owner@0509.io",
      email: silentBinding(sent),
      address: "owner@0509.io",
      resume: true,
    });

    expect(result).toEqual({ error: null, suppressed: false });
    expect(await suppressionAddresses()).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(await emailTarget(workspaceId)).toEqual({ target_value: "owner@0509.io", is_verified: 1 });
  });

  it("does not refuse a signed-in address that was never unsubscribed, whatever its stored casing", async () => {
    await seedOwner("Owner@0509.io");
    await suppress("someone-else@0509.io");

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: "Owner@0509.io",
      email: silentBinding([]),
      address: "OWNER@0509.io",
      resume: false,
    });

    expect(result).toEqual({ error: null, suppressed: false });
  });
});
