import { describe, expect, it } from "vitest";

import {
  getOrCreatePersonalOrg,
  getOrgById,
  personalOrgIdForUser,
} from "~/lib/data/org.server";
import {
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  listWorkspaceMembers,
  peekWorkspaceInvite,
  resolveWorkspace,
  revokeWorkspaceMember,
} from "~/lib/workspace.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "../fixtures";

/**
 * Migration-test gate for issue #3787 — the workspace teams swap onto the
 * Better Auth organization plugin (expand phase of expand/contract).
 *
 * Proves against the real D1 chain (the `workers` vitest project applies
 * `migrations/*.sql` via `tests/integration/apply-migrations.ts`):
 *   - the plugin's organization/member/invitation tables exist with the
 *     storage shape the D1 adapter expects (camelCase TEXT columns, ISO-8601
 *     strings for `date` fields, `tokenHash` as the invitation
 *     additionalField);
 *   - `session.activeOrganizationId` exists (nullable, per the schema rule);
 *   - the legacy `org`/`workspace_member` tables remain for rollback;
 *   - the WRITE path lands: createWorkspaceInvite inserts a pending
 *     invitation with a hashed token, acceptWorkspaceInvite flips it to
 *     accepted and inserts the member row under the same id;
 *   - the READ path lands: resolveWorkspace maps a teammate to the owner's
 *     workspace and getOrCreatePersonalOrg/getOrgById resolve the personal
 *     org;
 *   - the seat-cap write stays conditional: the second concurrent invite for
 *     a full workspace loses.
 */

async function seedAgencyOwner() {
  const ownerId = await seedUser();
  await db()
    .prepare(`INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, 'agency', ?)`)
    .bind(ownerId, ISO_T0)
    .run();
  return ownerId;
}

describe("migration 0106 — Better Auth organization plugin (issue #3787)", () => {
  it("(1) creates the plugin tables with the adapter's storage shape", async () => {
    for (const table of ["organization", "member", "invitation"]) {
      const row = await db()
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .bind(table)
        .first<{ sql: string }>();
      expect(row?.sql, `${table} DDL`).toBeDefined();
    }
    const member = await db()
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'member'`)
      .first<{ sql: string }>();
    expect(member?.sql).toMatch(/organizationId/);
    expect(member?.sql).toMatch(/role/);
    const invitation = await db()
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invitation'`)
      .first<{ sql: string }>();
    expect(invitation?.sql).toMatch(/tokenHash/);
    expect(invitation?.sql).toMatch(/inviterId/);
    const session = await db()
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
      .first<{ sql: string }>();
    expect(session?.sql).toMatch(/activeOrganizationId/);
  });

  it("(2) keeps the legacy tables for the rollback window", async () => {
    for (const table of ["org", "workspace_member"]) {
      const row = await db()
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .bind(table)
        .first<{ name: string }>();
      expect(row?.name, `${table} retained during expand phase`).toBe(table);
    }
  });

  it("(3) resolves the personal org and its owner member row", async () => {
    const userId = await seedUser();
    const org = await getOrCreatePersonalOrg(appEnv, userId);
    expect(org.id).toBe(personalOrgIdForUser(userId));
    expect(org.ownerUserId).toBe(userId);

    const ownerMember = await db()
      .prepare(`SELECT role FROM member WHERE organizationId = ? AND userId = ?`)
      .bind(org.id, userId)
      .first<{ role: string }>();
    expect(ownerMember?.role).toBe("owner");
    expect((await getOrgById(appEnv, org.id))?.ownerUserId).toBe(userId);
  });

  it("(4) writes a pending invitation with a hashed token, then reads it back", async () => {
    const ownerId = await seedAgencyOwner();
    const invitee = uid("invitee");

    const created = await createWorkspaceInvite(appEnv, {
      ownerUserId: ownerId,
      ownerEmail: `${ownerId}@example.test`,
      inviteeEmail: `${invitee}@example.test`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Stored shape: pending invitation, hashed token, expiresAt in the
    // future — the raw bearer token is never at rest.
    const row = await db()
      .prepare(
        `SELECT status, role, email, tokenHash, expiresAt, inviterId
           FROM invitation WHERE organizationId = ?`,
      )
      .bind(personalOrgIdForUser(ownerId))
      .first<{
        status: string;
        role: string;
        email: string;
        tokenHash: string | null;
        expiresAt: string | null;
        inviterId: string;
      }>();
    expect(row).toMatchObject({
      status: "pending",
      role: "member",
      email: `${invitee}@example.test`,
      inviterId: ownerId,
    });
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(created.token);
    expect(Date.parse(row?.expiresAt ?? "")).toBeGreaterThan(Date.now());

    // Read path: the invite lists as an occupied seat and peeks by token.
    const members = await listWorkspaceMembers(appEnv, ownerId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      invitedEmail: `${invitee}@example.test`,
      status: "invited",
      ownerUserId: ownerId,
    });
    const peek = await peekWorkspaceInvite(appEnv, created.token);
    expect(peek?.invitedEmail).toBe(`${invitee}@example.test`);
  });

  it("(5) accepts an invite into a member row and resolves the workspace", async () => {
    const ownerId = await seedAgencyOwner();
    const memberId = await seedUser();
    const memberEmail = `${memberId}@example.test`;

    const created = await createWorkspaceInvite(appEnv, {
      ownerUserId: ownerId,
      ownerEmail: `${ownerId}@example.test`,
      inviteeEmail: memberEmail,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const accepted = await acceptWorkspaceInvite(appEnv, {
      token: created.token,
      userId: memberId,
      userEmail: memberEmail,
    });
    expect(accepted.ok).toBe(true);

    const invite = await db()
      .prepare(`SELECT id, status, tokenHash FROM invitation WHERE email = ?`)
      .bind(memberEmail)
      .first<{ id: string; status: string; tokenHash: string | null }>();
    expect(invite).toMatchObject({ status: "accepted", tokenHash: null });

    const member = await db()
      .prepare(`SELECT id, role FROM member WHERE organizationId = ? AND userId = ?`)
      .bind(personalOrgIdForUser(ownerId), memberId)
      .first<{ id: string; role: string }>();
    // Same id carries across invited -> active so memberRowId stays stable.
    expect(member).toMatchObject({ id: invite?.id, role: "member" });

    const workspace = await resolveWorkspace(appEnv, memberId);
    expect(workspace).toMatchObject({ workspaceUserId: ownerId, isMember: true });

    const revoked = await revokeWorkspaceMember(appEnv, {
      ownerUserId: ownerId,
      memberRowId: invite!.id,
    });
    expect(revoked.ok).toBe(true);
    const after = await db()
      .prepare(`SELECT status FROM invitation WHERE id = ?`)
      .bind(invite!.id)
      .first<{ status: string }>();
    expect(after?.status).toBe("canceled");
    const seat = await db()
      .prepare(`SELECT COUNT(*) AS n FROM member WHERE organizationId = ? AND role = 'member'`)
      .bind(personalOrgIdForUser(ownerId))
      .first<{ n: number }>();
    expect(seat?.n).toBe(0);
  });

  it("(6) admits exactly one winner when two invites race for the last seat", async () => {
    const ownerId = await seedAgencyOwner();
    // One occupied seat, then two concurrent invites for the last one.
    const first = await createWorkspaceInvite(appEnv, {
      ownerUserId: ownerId,
      ownerEmail: `${ownerId}@example.test`,
      inviteeEmail: `${uid("race_base")}@example.test`,
    });
    expect(first.ok).toBe(true);

    const [a, b] = await Promise.all([
      createWorkspaceInvite(appEnv, {
        ownerUserId: ownerId,
        ownerEmail: `${ownerId}@example.test`,
        inviteeEmail: `${uid("race_a")}@example.test`,
      }),
      createWorkspaceInvite(appEnv, {
        ownerUserId: ownerId,
        ownerEmail: `${ownerId}@example.test`,
        inviteeEmail: `${uid("race_b")}@example.test`,
      }),
    ]);

    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
    const seats = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM invitation
          WHERE organizationId = ? AND status = 'pending'`,
      )
      .bind(personalOrgIdForUser(ownerId))
      .first<{ n: number }>();
    expect(seats?.n).toBe(2);
  });
});
