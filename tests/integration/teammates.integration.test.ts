import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { isTeammateUnsubscribeToken, suppressByUnsubscribeToken } from "../../app/lib/data/email_suppression.server";
import { takeRecipientSlot } from "../../app/lib/recipient-cap.server";
import { clearRecipientCap } from "./clear-recipient-cap";

import {
  changeEmailTarget,
  ensureOwnerEmailTarget,
  markEmailTargetVerified,
  readEmailTarget,
  removeTeammate,
  writeVerifyToken,
} from "../../app/lib/data/send_target.server";
import { readDeliveryAddress, saveDeliveryAddress } from "../../app/lib/delivery-address.server";
import { addTeammateByOwner, readTeammates, removeTeammateByOwner } from "../../app/lib/teammates.server";
import { confirmDeliveryAddress } from "../../app/lib/verify-delivery-address.server";
import { ensureWorkspaceForSignIn, firstWorkspaceId } from "../../app/lib/workspace.server";

let USER_ID = "user-mates";
const SIGN_IN_EMAIL = "owner@0509.io";
const NOW = "2026-10-14T00:00:00Z";

const sentMail: EmailMessageBuilder[] = [];

const binding: SendEmail = {
  send(message: EmailMessage | EmailMessageBuilder) {
    sentMail.push(message as EmailMessageBuilder);
    return Promise.resolve({ messageId: "test-message" });
  },
};

const add = (address: string) =>
  addTeammateByOwner({ userId: USER_ID, signInEmail: SIGN_IN_EMAIL, address, email: binding });

const emailedToken = (): string => {
  const link = /https:\/\/0509\.io\/v\/([0-9a-f]{64})/.exec(sentMail.at(-1)?.text ?? "");
  if (link === null) throw new Error("expected a confirmation link in the sent email");
  return link[1];
};

describe("teammates on the brief", () => {
  beforeEach(async () => {
    await clearRecipientCap();
    USER_ID = `user-mates-${crypto.randomUUID()}`;
    sentMail.length = 0;
    await env.DB.exec("DELETE FROM email_suppression");
    await env.DB.exec("DELETE FROM send_target");
    await env.DB.exec("DELETE FROM channel");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES ('chan-email', 'email', 1, '{}')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
    )
      .bind(USER_ID, SIGN_IN_EMAIL, NOW, NOW)
      .run();
    await ensureWorkspaceForSignIn(env.DB, { userId: USER_ID, request: null, now: NOW });
  });

  it("invites by email, lists the teammate as waiting, and confirms with the link", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);

    expect(await add("Mate@0509.io")).toBeNull();

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe("mate@0509.io");
    expect(sentMail[0].subject).toContain(SIGN_IN_EMAIL);
    expect(await readTeammates(workspaceId)).toMatchObject([{ address: "mate@0509.io", confirmed: false }]);

    await confirmDeliveryAddress(emailedToken());

    expect(await readTeammates(workspaceId)).toMatchObject([{ address: "mate@0509.io", confirmed: true }]);
  });

  it("leaves the owner's own delivery address alone", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await add("mate@0509.io");
    await confirmDeliveryAddress(emailedToken());

    expect(await readEmailTarget(env.DB, workspaceId)).toEqual({ target_value: SIGN_IN_EMAIL, is_verified: 1 });
    expect(await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL)).toEqual({ address: SIGN_IN_EMAIL, verified: true });
  });

  it("refuses the owner's own sign-in address in any case, and sends nothing", async () => {
    expect(await add(SIGN_IN_EMAIL)).toMatch(/We can't add that address/);
    expect(await add(SIGN_IN_EMAIL.toUpperCase())).toMatch(/We can't add that address/);
    expect(sentMail).toHaveLength(0);
    expect(await readTeammates(firstWorkspaceId(USER_ID))).toEqual([]);
  });

  it("allows two teammates and each address once, and refuses the owner's own address", async () => {
    expect(await add("a@0509.io")).toBeNull();
    expect(await add("A@0509.io")).toMatch(/up to 2 teammates/);
    expect(await add(SIGN_IN_EMAIL)).toMatch(/up to 2 teammates/);
    expect(await add("b@0509.io")).toBeNull();
    expect(await add("c@0509.io")).toMatch(/up to 2 teammates/);
    expect(sentMail).toHaveLength(2);
  });

  it("stops inviting one address once it has had three emails from us in a day", async () => {
    for (let round = 0; round < 3; round += 1) expect(await takeRecipientSlot("loop@0509.io")).toBe(true);

    expect(await add("loop@0509.io")).toMatch(/several emails/);
    expect(sentMail).toHaveLength(0);
    expect(await add("other@0509.io")).toBeNull();
  });

  it("refuses a malformed address and sends nothing", async () => {
    await env.DB.prepare("INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', ?)")
      .bind("gone@0509.io", NOW)
      .run();

    for (const bad of ["not an address", "a,b@0509.io", "a b@0509.io", "a@localhost", "a@@0509.io"]) {
      expect(await add(bad)).toMatch(/Enter an email address/);
    }
    expect(sentMail).toHaveLength(0);
    expect(await readTeammates(firstWorkspaceId(USER_ID))).toEqual([]);
  });

  it("keeps every owner-address read and write on the owner when a teammate row is older", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, role)
       VALUES ('mate-old', ?, 'chan-email', 'mate@0509.io', 0, '2000-01-01T00:00:00Z', 'teammate')`,
    )
      .bind(workspaceId)
      .run();
    const mate = () =>
      env.DB.prepare("SELECT target_value, is_verified, verify_token FROM send_target WHERE id = 'mate-old'").first();

    expect(await readEmailTarget(env.DB, workspaceId)).toEqual({ target_value: SIGN_IN_EMAIL, is_verified: 1 });
    await writeVerifyToken(env.DB, { workspaceId, token: "owner-token", expiresAt: "2999-01-01T00:00:00Z" });
    await markEmailTargetVerified(env.DB, { workspaceId });
    await changeEmailTarget(env.DB, { workspaceId, address: "new-owner@0509.io" });

    expect(await mate()).toEqual({ target_value: "mate@0509.io", is_verified: 0, verify_token: null });
    expect(await readEmailTarget(env.DB, workspaceId)).toEqual({ target_value: "new-owner@0509.io", is_verified: 0 });
    await env.DB.prepare("DELETE FROM send_target WHERE workspace_id = ? AND role = 'owner'").bind(workspaceId).run();
    await ensureOwnerEmailTarget(env.DB, { workspaceId, now: NOW });
    const rows = await env.DB.prepare("SELECT role FROM send_target WHERE workspace_id = ? ORDER BY role")
      .bind(workspaceId)
      .all();
    expect(rows.results).toEqual([{ role: "owner" }, { role: "teammate" }]);
  });

  it("refuses to make a teammate's address the owner's delivery address", async () => {
    await add("mate@0509.io");

    const result = await saveDeliveryAddress({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "Mate@0509.io",
      resume: false,
      email: binding,
    });

    expect(result.error).toMatch(/already gets the brief as a teammate/);
    expect(await readDeliveryAddress(USER_ID, SIGN_IN_EMAIL)).toEqual({ address: SIGN_IN_EMAIL, verified: true });
  });

  it("stops sending invitations after a few a day, even when each one is removed again", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    for (let sent = 0; sent < 4; sent += 1) {
      expect(await add(`loop${String(sent)}@0509.io`)).toBeNull();
      const [mate] = await readTeammates(workspaceId);
      await removeTeammateByOwner(USER_ID, mate.id);
    }

    expect(await add("loop4@0509.io")).toMatch(/lot of invitations today/);
    expect(sentMail).toHaveLength(4);
  });

  it("does not use up a slot when the invitation fails to send", async () => {
    const broken: SendEmail = { send: () => Promise.reject(new Error("down")) };
    const failed = await addTeammateByOwner({
      userId: USER_ID,
      signInEmail: SIGN_IN_EMAIL,
      address: "retry@0509.io",
      email: broken,
    });
    expect(failed).not.toBeNull();
    const [mate] = await readTeammates(firstWorkspaceId(USER_ID));
    await removeTeammateByOwner(USER_ID, mate.id);

    expect(await add("retry@0509.io")).toBeNull();
    expect(sentMail).toHaveLength(1);
  });

  it("accepts an unsubscribed address like any other but sends it no invitation, so it cannot be probed", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await env.DB.prepare("INSERT INTO email_suppression (address, reason, created_at) VALUES (?, 'unsubscribed', ?)")
      .bind("quiet@0509.io", NOW)
      .run();

    expect(await add("quiet@0509.io")).toBeNull();
    expect(await add("fresh@0509.io")).toBeNull();

    expect(sentMail.map((mail) => mail.to)).toEqual(["fresh@0509.io"]);
    expect(await readTeammates(workspaceId)).toEqual([
      expect.objectContaining({ address: "quiet@0509.io", confirmed: false, unsubscribed: false }),
      expect.objectContaining({ address: "fresh@0509.io", confirmed: false, unsubscribed: false }),
    ]);
  });

  it("shows a teammate who unsubscribed, and tells their link apart from the owner's", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await add("mate@0509.io");
    await confirmDeliveryAddress(emailedToken());
    await env.DB.prepare(
      "UPDATE send_target SET unsubscribe_token = 'mate-token' WHERE workspace_id = ? AND role = 'teammate'",
    )
      .bind(workspaceId)
      .run();
    await env.DB.prepare(
      "UPDATE send_target SET unsubscribe_token = 'owner-token' WHERE workspace_id = ? AND role = 'owner'",
    )
      .bind(workspaceId)
      .run();

    expect((await readTeammates(workspaceId))[0]?.unsubscribed).toBe(false);
    await suppressByUnsubscribeToken("mate-token", "all");

    expect((await readTeammates(workspaceId))[0]?.unsubscribed).toBe(true);
    expect(await isTeammateUnsubscribeToken("mate-token")).toBe(true);
    expect(await isTeammateUnsubscribeToken("owner-token")).toBe(false);
  });

  it("removes a teammate, but never the owner's row", async () => {
    const workspaceId = firstWorkspaceId(USER_ID);
    await add("mate@0509.io");
    const [mate] = await readTeammates(workspaceId);
    const owner = await env.DB.prepare("SELECT id FROM send_target WHERE role = 'owner'").first<{ id: string }>();

    await removeTeammate(env.DB, { workspaceId, targetId: owner?.id ?? "none" });
    expect(await readEmailTarget(env.DB, workspaceId)).not.toBeNull();

    await env.DB.prepare(
      `INSERT INTO send_attempt (id, workspace_id, send_target_id, digest_id, idempotency_key, status, attempted_at)
       VALUES ('att-mate', ?, ?, NULL, 'digest:d:mate', 'sent', ?)`,
    )
      .bind(workspaceId, mate.id, NOW)
      .run();

    await removeTeammateByOwner(USER_ID, mate.id);
    expect(await readTeammates(workspaceId)).toEqual([]);
    expect(await env.DB.prepare("SELECT status FROM send_attempt WHERE id = 'att-mate'").first()).toEqual({
      status: "sent",
    });
  });
});
