// Org-owner multi-member block (issue #3168). The /api/account/delete-request
// route must block deletion when the user owns an org with other members,
// because removing the user row would orphan the rest of the workspace
// (the org has a CASCADE FK to user.id). The transfer UI lives in epic
// #2993 — this test only guards the gate.

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { isUserOrgOwnerOfMultiMemberOrg } from "~/lib/account-self-serve.server";

import "./apply-migrations";

const ISO_T0 = "2026-01-01T00:00:00.000Z";

async function seedUser(id: string) {
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `Fixture ${id}`, `${id}@example.test`, ISO_T0, ISO_T0)
    .run();
}

async function seedOrg(id: string, ownerUserId: string) {
  await env.DB.prepare(
    `INSERT INTO org (id, name, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, ownerUserId, ISO_T0, ISO_T0)
    .run();
}

async function seedMember(opts: {
  ownerUserId: string;
  memberUserId: string | null;
  invitedEmail: string;
  id?: string;
  status?: string;
}) {
  const id = opts.id ?? `wm_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO workspace_member (
       id, owner_user_id, member_user_id, invited_email, role, status,
       created_at
     ) VALUES (?, ?, ?, ?, 'member', ?, ?)`,
  )
    .bind(id, opts.ownerUserId, opts.memberUserId, opts.invitedEmail, opts.status ?? "active", ISO_T0)
    .run();
  return id;
}

describe("account-self-serve: org-owner multi-member block", () => {
  it("returns 0 when the user owns no org", async () => {
    const userId = `solo_${crypto.randomUUID().slice(0, 8)}`;
    await seedUser(userId);
    const result = await isUserOrgOwnerOfMultiMemberOrg(env as never, userId);
    expect(result.ownerOfOrgsWithOtherMembers).toBe(0);
    expect(result.orgIds).toEqual([]);
  });

  it("returns 0 when the user owns an org with only themselves as a member", async () => {
    const userId = `lonely_${crypto.randomUUID().slice(0, 8)}`;
    const orgId = `org_${crypto.randomUUID().slice(0, 8)}`;
    await seedUser(userId);
    await seedOrg(orgId, userId);
    // No workspace_member rows: the user is the sole owner.
    const result = await isUserOrgOwnerOfMultiMemberOrg(env as never, userId);
    expect(result.ownerOfOrgsWithOtherMembers).toBe(0);
  });

  it("returns 1+ when the user owns an org that has another member", async () => {
    const ownerId = `owner_${crypto.randomUUID().slice(0, 8)}`;
    const memberId = `member_${crypto.randomUUID().slice(0, 8)}`;
    const orgId = `org_${crypto.randomUUID().slice(0, 8)}`;
    await seedUser(ownerId);
    await seedUser(memberId);
    await seedOrg(orgId, ownerId);
    await seedMember({
      ownerUserId: ownerId,
      memberUserId: memberId,
      invitedEmail: `${memberId}@example.test`,
    });

    const result = await isUserOrgOwnerOfMultiMemberOrg(env as never, ownerId);
    expect(result.ownerOfOrgsWithOtherMembers).toBe(1);
    expect(result.orgIds).toContain(orgId);
  });

  it("does not count pending-only invite rows as members", async () => {
    // The transfer epic (#2993) decides whether an unaccepted invite counts
    // as a "member" for the purpose of this gate. Until that ships we
    // count accepted rows only — pending invites do not block deletion.
    // This test pins the current behavior; change the assertion if the
    // epic decides otherwise.
    const ownerId = `owner_${crypto.randomUUID().slice(0, 8)}`;
    const orgId = `org_${crypto.randomUUID().slice(0, 8)}`;
    await seedUser(ownerId);
    await seedOrg(orgId, ownerId);
    await seedMember({
      ownerUserId: ownerId,
      memberUserId: null,
      invitedEmail: `pending_${crypto.randomUUID().slice(0, 4)}@example.test`,
      status: "invited",
    });

    const result = await isUserOrgOwnerOfMultiMemberOrg(env as never, ownerId);
    expect(result.ownerOfOrgsWithOtherMembers).toBe(0);
  });
});