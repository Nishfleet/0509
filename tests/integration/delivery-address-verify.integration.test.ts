import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readDeliveryAddress, saveDeliveryAddress } from "../../app/lib/delivery-address.server";
import { confirmDeliveryAddress } from "../../app/lib/verify-delivery-address.server";
import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";

const USER_ID = "user-dav";
const SIGN_IN_EMAIL = "owner@0509.io";
const NOW = "2026-09-28T00:00:00Z";
const NEW_ADDRESS = "new@0509.io";

interface Recorder {
  sent: EmailMessageBuilder[];
  fail: Error | null;
}

const recorder = (): Recorder => ({ sent: [], fail: null });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder) {
    if (rec.fail) throw rec.fail;
    rec.sent.push(message);
    return Promise.resolve({ messageId: "test-message" });
  },
});

interface TargetRow {
  target_value: string;
  is_verified: number;
  unsubscribe_token: string | null;
  verify_token: string | null;
}

const target = async (workspaceId: string): Promise<TargetRow | null> =>
  await env.DB.prepare(
    `SELECT target_value, is_verified, unsubscribe_token, verify_token
       FROM send_target
      WHERE workspace_id = ?
      ORDER BY created_at ASC
      LIMIT 1`,
  )
    .bind(workspaceId)
    .first<TargetRow>();

const onlyTarget = async (workspaceId: string): Promise<TargetRow> => {
  const row = await target(workspaceId);
  if (row === null) throw new Error("the workspace has no email target");
  return row;
};

const emailedToken = (rec: Recorder): string => {
  const link = /https:\/\/0509\.io\/v\/([0-9a-f]{64})/.exec(rec.sent.at(-1)?.text ?? "");
  if (link === null) throw new Error("expected a confirmation link in the sent email");
  return link[1];
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const save = (rec: Recorder, address: string) =>
  saveDeliveryAddress({
    userId: USER_ID,
    signInEmail: SIGN_IN_EMAIL,
    email: bindingFor(rec),
    address,
    resume: false,
  });

describe("confirm a changed delivery address (0509#5811)", () => {
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

  it("(a) changing to a new address stores an opaque token and emails the confirmation link", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const rec = recorder();

    const result = await save(rec, NEW_ADDRESS);
    expect(result).toEqual({ error: null, suppressed: false });

    const row = await onlyTarget(workspaceId);
    expect(row).toMatchObject({ target_value: NEW_ADDRESS, is_verified: 0, unsubscribe_token: null });
    const token = emailedToken(rec);
    expect(row.verify_token).toBe(await sha256Hex(token));
    expect(row.verify_token).not.toBe(token);

    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].to).toBe(NEW_ADDRESS);
    expect(rec.sent[0].from).toEqual({ email: "hello@0509.io", name: "Five to Nine" });
    expect(rec.sent[0].subject).toBe("Confirm your delivery email for Five to Nine");
    expect(rec.sent[0].text).toContain(`We sent this to ${NEW_ADDRESS}.`);
    expect(rec.sent[0].text).toContain(`https://0509.io/v/${token}`);
    expect(rec.sent[0].html).toContain(`https://0509.io/v/${token}`);
  });

  it("(b) saving the same unverified address again writes a fresh token and sends again", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const first = recorder();

    await save(first, NEW_ADDRESS);
    const firstHash = (await onlyTarget(workspaceId)).verify_token;
    const firstToken = emailedToken(first);
    expect(first.sent).toHaveLength(1);

    const resend = recorder();
    const result = await save(resend, NEW_ADDRESS);

    expect(result).toEqual({ error: null, suppressed: false });
    const secondToken = emailedToken(resend);
    const secondHash = (await onlyTarget(workspaceId)).verify_token;
    expect(secondHash).toBe(await sha256Hex(secondToken));
    expect(secondHash).not.toBe(firstHash);
    expect(secondToken).not.toBe(firstToken);
    expect(resend.sent).toHaveLength(1);
    expect(resend.sent[0].text).toContain(`https://0509.io/v/${secondToken}`);
  });

  it("a rotated token no longer confirms the row", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const first = recorder();
    await save(first, NEW_ADDRESS);
    const firstToken = emailedToken(first);

    await save(recorder(), "other@0509.io");
    await confirmDeliveryAddress(firstToken);

    expect(await onlyTarget(workspaceId)).toMatchObject({
      target_value: "other@0509.io",
      is_verified: 0,
    });
  });

  it("(c) saving the sign-in address verifies at once and sends nothing", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const changed = recorder();
    await save(changed, NEW_ADDRESS);
    expect(changed.sent).toHaveLength(1);

    const back = recorder();
    const result = await save(back, SIGN_IN_EMAIL);

    expect(result).toEqual({ error: null, suppressed: false });
    expect(back.sent).toHaveLength(0);
    const row = await onlyTarget(workspaceId);
    expect(row).toMatchObject({ target_value: SIGN_IN_EMAIL, is_verified: 1, verify_token: null });
  });

  it("(d) a failed send keeps the saved address unverified and reports the failure", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const rec = recorder();
    rec.fail = new Error("email binding refused the message");

    const result = await save(rec, NEW_ADDRESS);

    expect(result.error).not.toBeNull();
    expect(result.suppressed).toBe(false);
    const row = await onlyTarget(workspaceId);
    // The token write deliberately precedes the send: a retry after a failed send writes a fresh token.
    expect(row).toMatchObject({ target_value: NEW_ADDRESS, is_verified: 0 });
    expect(row.verify_token).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.sent).toHaveLength(0);
  });

  it("(e) readDeliveryAddress reports the sign-in fallback as verified and a changed address as unverified", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    expect(await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL)).toEqual({
      address: SIGN_IN_EMAIL,
      verified: true,
    });

    await save(recorder(), NEW_ADDRESS);

    expect(await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL)).toEqual({
      address: NEW_ADDRESS,
      verified: false,
    });
    expect((await onlyTarget(workspaceId)).verify_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("confirmDeliveryAddress verifies the row; a second confirm with the same token is a no-op", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const rec = recorder();
    await save(rec, NEW_ADDRESS);
    const token = emailedToken(rec);

    await confirmDeliveryAddress(token);
    expect(await onlyTarget(workspaceId)).toMatchObject({
      target_value: NEW_ADDRESS,
      is_verified: 1,
      verify_token: null,
    });

    await confirmDeliveryAddress(token);
    expect(await onlyTarget(workspaceId)).toMatchObject({
      target_value: NEW_ADDRESS,
      is_verified: 1,
      verify_token: null,
    });
  });

  it("confirmDeliveryAddress treats an expired token like an unknown one", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    const rec = recorder();
    await save(rec, NEW_ADDRESS);
    const token = emailedToken(rec);
    await env.DB.prepare("UPDATE send_target SET verify_token_expires_at = ? WHERE workspace_id = ?")
      .bind("2020-01-01T00:00:00.000Z", workspaceId)
      .run();
    const before = await onlyTarget(workspaceId);

    await confirmDeliveryAddress(token);

    expect(await onlyTarget(workspaceId)).toEqual(before);
  });

  it("confirmDeliveryAddress does not match the stored hash presented as a token", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await save(recorder(), NEW_ADDRESS);
    const before = await onlyTarget(workspaceId);
    if (before.verify_token === null) throw new Error("expected a stored verify hash");

    await confirmDeliveryAddress(before.verify_token);

    expect(await onlyTarget(workspaceId)).toEqual(before);
  });

  it("confirmDeliveryAddress writes nothing for an unknown, empty, or missing token", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await save(recorder(), NEW_ADDRESS);
    const before = await onlyTarget(workspaceId);

    await confirmDeliveryAddress("f".repeat(64));
    await confirmDeliveryAddress("");
    await confirmDeliveryAddress(undefined);

    expect(await onlyTarget(workspaceId)).toEqual(before);
  });
});
