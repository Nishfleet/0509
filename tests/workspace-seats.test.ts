import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENCY_SEAT_LIMIT,
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  listWorkspaceMembers,
  resendWorkspaceInvite,
  revokeWorkspaceMember,
  resolveWorkspace,
  workspaceMemberOccupiesSeat,
} from "~/lib/workspace.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(async (_env: unknown, userId: string) =>
    userId.startsWith("agency") ? "agency" : "starter",
  ),
}));

interface FakeRow {
  [key: string]: unknown;
}

function fakeDb(state: { firstResults?: FakeRow[]; allResults?: FakeRow[]; runChanges?: number } = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings });
          return {
            first: async () => (state.firstResults ?? []).shift() ?? null,
            all: async () => ({ results: state.allResults ?? [] }),
            run: async () => ({ meta: { changes: state.runChanges ?? 1 } }),
          };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return { db, calls };
}

function envWith(db: unknown) {
  return { DB: db } as never;
}

function workspaceSqlite() {
  const harness = createSqliteD1();
  applyMigration(harness.sqlite, "migrations/0000_auth.sql");
  harness.sqlite.exec(`
    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      dodo_status TEXT,
      dodo_next_billing_at TEXT
    );
  `);
  applyMigration(harness.sqlite, "migrations/0027_workspace_members.sql");
  applyMigration(harness.sqlite, "migrations/0106_organization_plugin.sql");
  harness.sqlite.exec(`
    INSERT INTO user (id, name, email, createdAt, updatedAt)
    VALUES
      ('agency-owner', 'Asha', 'owner@x.com', datetime('now'), datetime('now')),
      ('agency-other', 'Bela', 'other@x.com', datetime('now'), datetime('now')),
      ('member-1', 'Member One', 'member@x.com', datetime('now'), datetime('now')),
      ('member-2', 'Member Two', 'member2@x.com', datetime('now'), datetime('now')),
      ('member-3', 'Member Three', 'member3@x.com', datetime('now'), datetime('now'));
    INSERT INTO user_plan (user_id, plan)
    VALUES ('agency-owner', 'agency'), ('agency-other', 'agency');
    INSERT INTO organization (id, name, slug, createdAt, metadata)
      SELECT 'org_' || id, name, 'org-' || id, createdAt, json_object('ownerUserId', id) FROM user;
    INSERT INTO member (id, organizationId, userId, role, createdAt)
      SELECT 'mem_' || id, 'org_' || id, id, 'owner', createdAt FROM user;
  `);
  return harness;
}

function seatRows(harness: ReturnType<typeof createSqliteD1>, orgUserId: string) {
  return harness.sqlite
    .prepare(
      `SELECT kind, id FROM (
         SELECT 'member' AS kind, id FROM member
          WHERE organizationId = 'org_' || ? AND role = 'member'
         UNION ALL
         SELECT 'invite' AS kind, id FROM invitation
          WHERE organizationId = 'org_' || ? AND status = 'pending'
       )`,
    )
    .all(orgUserId, orgUserId);
}

const sqliteFixtures: Array<ReturnType<typeof createSqliteD1>> = [];
afterEach(() => {
  while (sqliteFixtures.length > 0) sqliteFixtures.pop()?.close();
});

describe("workspace seats", () => {
  it("non-members resolve to their own workspace", async () => {
    const { db } = fakeDb({ firstResults: [] });
    const ctx = await resolveWorkspace(envWith(db), "user-1");
    expect(ctx).toEqual({ workspaceUserId: "user-1", isMember: false, ownerName: null });
  });

  it("members of an agency owner resolve to the owner's workspace", async () => {
    const { db } = fakeDb({
      firstResults: [{ ownerUserId: "agency-owner", ownerName: "Asha" }],
    });
    const ctx = await resolveWorkspace(envWith(db), "member-1");
    expect(ctx).toEqual({ workspaceUserId: "agency-owner", isMember: true, ownerName: "Asha" });
  });

  it("membership goes dormant when the owner's plan is no longer agency", async () => {
    const { db } = fakeDb({
      firstResults: [{ ownerUserId: "downgraded-owner", ownerName: "Asha" }],
    });
    const ctx = await resolveWorkspace(envWith(db), "member-1");
    expect(ctx).toEqual({ workspaceUserId: "member-1", isMember: false, ownerName: null });
  });

  it("rejects invites beyond the seat limit", async () => {
    const existing = Array.from({ length: AGENCY_SEAT_LIMIT - 1 }, (_, index) => ({
      id: `m-${index}`,
      ownerUserId: "agency-owner",
      memberUserId: null,
      invitedEmail: `m${index}@x.com`,
      status: "invited",
      createdAt: "2026-06-13",
      acceptedAt: null,
    }));
    const { db } = fakeDb({ allResults: existing });
    const result = await createWorkspaceInvite(envWith(db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "new@x.com",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invites from non-agency plans", async () => {
    const { db } = fakeDb({ allResults: [] });
    const result = await createWorkspaceInvite(envWith(db), {
      ownerUserId: "starter-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "new@x.com",
    });
    expect(result).toEqual({ ok: false, reason: "Team seats are part of the Agency plan." });
  });

  it("resends pending invites with a fresh token expiry", async () => {
    const { db, calls } = fakeDb({
      firstResults: [
        {
          id: "member-1",
          invitedEmail: "member@x.com",
          status: "pending",
        },
      ],
    });

    const result = await resendWorkspaceInvite(envWith(db), {
      ownerUserId: "agency-owner",
      memberRowId: "member-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inviteeEmail).toBe("member@x.com");
      expect(result.token.length).toBeGreaterThan(40);
    }
    const update = calls.find((call) => call.sql.includes("UPDATE invitation"));
    expect(update?.sql).toContain("expiresAt");
    expect(update?.bindings[2]).toBe("member-1");
    expect(update?.bindings[3]).toBe("agency-owner");
  });

  it("does not report an invite insert that changed zero rows as success", async () => {
    const { db } = fakeDb({
      firstResults: [
        { name: "Asha", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        {
          id: "org_agency-owner",
          name: "Asha",
          ownerUserId: "agency-owner",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ],
      runChanges: 0,
    });
    await expect(
      createWorkspaceInvite(envWith(db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "new@x.com",
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("does not resend accepted invitations", async () => {
    const { db } = fakeDb({
      firstResults: [
        {
          id: "member-1",
          invitedEmail: "member@x.com",
          status: "accepted",
        },
      ],
    });

    const result = await resendWorkspaceInvite(envWith(db), {
      ownerUserId: "agency-owner",
      memberRowId: "member-1",
    });

    expect(result).toEqual({ ok: false, reason: "Only pending invites can be resent." });
  });

  it("rejects accepting when already in another workspace", async () => {
    const { db } = fakeDb({
      firstResults: [
        {
          id: "m-1",
          organizationId: "org_agency-owner",
          ownerUserId: "agency-owner",
          invitedEmail: "member@x.com",
          tokenExpiresAt: null,
          status: "pending",
          ownerName: "Asha",
        },
        { id: "existing-membership" },
      ],
    });
    const result = await acceptWorkspaceInvite(envWith(db), {
      token: "tok",
      userId: "member-1",
      userEmail: "member@x.com",
    });
    expect(result).toEqual({
      ok: false,
      reason: "You already belong to a workspace — leave it before joining another.",
    });
  });

  it("rejects accepting an invite sent to a different email", async () => {
    const { db } = fakeDb({
      firstResults: [
        {
          id: "m-1",
          organizationId: "org_agency-owner",
          ownerUserId: "agency-owner",
          invitedEmail: "right@x.com",
          tokenExpiresAt: null,
          status: "pending",
          ownerName: "Asha",
        },
      ],
    });
    const result = await acceptWorkspaceInvite(envWith(db), {
      token: "tok",
      userId: "member-1",
      userEmail: "wrong@x.com",
    });
    expect(result).toEqual({
      ok: false,
      reason: "This invite was sent to a different email address.",
    });
  });

  it("admits at most one of two concurrent invites at the last available seat", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation (id, organizationId, email, role, status, createdAt, inviterId)
      VALUES ('existing', 'org_agency-owner', 'existing@x.com', 'member', 'pending', datetime('now'), 'agency-owner');
    `);

    const [first, second] = await Promise.all([
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "new-one@x.com",
      }),
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "new-two@x.com",
      }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect(seatRows(harness, "agency-owner")).toHaveLength(2);
  });

  it("does not count expired pending invitations as occupied seats", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('expired-seat', 'org_agency-owner', 'expired@x.com', 'member', 'pending', datetime('now', '-1 minute'), datetime('now', '-2 day'), 'agency-owner', 'expired-token'),
        ('live-seat', 'org_agency-owner', 'live@x.com', 'member', 'pending', datetime('now', '+1 day'), datetime('now'), 'agency-owner', 'live-token');
    `);

    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "new@x.com",
    });

    expect(invite.ok).toBe(true);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM invitation WHERE organizationId = 'org_agency-owner'").get(),
    ).toEqual({ count: 3 });
  });

  it("fails closed when an invitation expiry is malformed", () => {
    expect(workspaceMemberOccupiesSeat({ status: "invited", tokenExpiresAt: "not-a-date" })).toBe(true);
  });

  it("keeps a same-owner expired invite visible and refreshable without duplicating it", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);
    harness.sqlite.exec(
      "UPDATE invitation SET expiresAt = datetime('now', '-1 minute') WHERE email = 'member@x.com'",
    );

    const members = await listWorkspaceMembers(envWith(harness.db), "agency-owner");
    expect(members).toHaveLength(1);
    await expect(
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "member@x.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "That teammate is already invited." });
    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: members[0]!.id,
      }),
    ).resolves.toMatchObject({ ok: true, inviteeEmail: "member@x.com" });
    const refreshed = harness.sqlite
      .prepare("SELECT expiresAt FROM invitation WHERE id = ?")
      .get(members[0]!.id) as { expiresAt: string };
    expect(Date.parse(refreshed.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("does not let an expired invite in another workspace lock an email forever", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('expired-other', 'org_agency-other', 'member@x.com', 'member', 'pending', datetime('now', '-1 minute'), datetime('now', '-2 day'), 'agency-other', 'old-token');
    `);

    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });

    expect(invite.ok).toBe(true);
    expect(
      harness.sqlite
        .prepare("SELECT organizationId FROM invitation WHERE email = 'member@x.com' ORDER BY organizationId")
        .all(),
    ).toEqual([{ organizationId: "org_agency-other" }, { organizationId: "org_agency-owner" }]);
  });

  it("still blocks an email with a live invitation in another workspace", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('live-other', 'org_agency-other', 'member@x.com', 'member', 'pending', datetime('now', '+1 day'), datetime('now'), 'agency-other', 'live-token');
    `);

    await expect(
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "member@x.com",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM invitation WHERE email = 'member@x.com'").get(),
    ).toEqual({ count: 1 });
  });

  it("admits only one of two workspaces racing to invite the same email", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);

    const [first, second] = await Promise.all([
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "member@x.com",
      }),
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-other",
        ownerEmail: "other@x.com",
        inviteeEmail: "member@x.com",
      }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM invitation WHERE email = 'member@x.com'").get(),
    ).toEqual({ count: 1 });
  });

  it("does not resurrect an expired invite while another workspace has a live one", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('expired-other', 'org_agency-other', 'member@x.com', 'member', 'pending', datetime('now', '-1 minute'), datetime('now', '-2 day'), 'agency-other', 'old-token');
    `);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);

    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-other",
        memberRowId: "expired-other",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT tokenHash FROM invitation WHERE id = 'expired-other'").get(),
    ).toEqual({ tokenHash: "old-token" });
  });

  it("does not resend an expired invite to an email that is already an active member", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO member (id, organizationId, userId, role, createdAt)
      VALUES ('active-member', 'org_agency-owner', 'member-1', 'member', datetime('now'));
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('expired-other', 'org_agency-other', 'member@x.com', 'member', 'pending', datetime('now', '-1 minute'), datetime('now', '-2 day'), 'agency-other', 'old-token');
    `);

    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-other",
        memberRowId: "expired-other",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT tokenHash FROM invitation WHERE id = 'expired-other'").get(),
    ).toEqual({ tokenHash: "old-token" });
  });

  it("does not resend an expired invitation after its seat has been reallocated", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation
        (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, tokenHash)
      VALUES
        ('expired-seat', 'org_agency-owner', 'expired@x.com', 'member', 'pending', datetime('now', '-1 minute'), datetime('now', '-2 day'), 'agency-owner', 'expired-token'),
        ('live-seat-1', 'org_agency-owner', 'live1@x.com', 'member', 'pending', datetime('now', '+1 day'), datetime('now'), 'agency-owner', 'live-token-1'),
        ('live-seat-2', 'org_agency-owner', 'live2@x.com', 'member', 'pending', datetime('now', '+1 day'), datetime('now'), 'agency-owner', 'live-token-2');
    `);

    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: "expired-seat",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT tokenHash FROM invitation WHERE id = 'expired-seat'").get(),
    ).toEqual({ tokenHash: "expired-token" });
  });

  it("fails closed when duplicate active memberships exist", async () => {
    const { db } = fakeDb({
      firstResults: [{ ownerUserId: "agency-owner", ownerName: "Asha", membershipCount: 2 }],
    });
    await expect(resolveWorkspace(envWith(db), "member-1")).resolves.toEqual({
      workspaceUserId: "member-1",
      isMember: false,
      ownerName: null,
    });
  });

  it("blocks acceptance after the owner loses Agency", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);
    harness.sqlite.exec("UPDATE user_plan SET plan = 'starter' WHERE user_id = 'agency-owner'");

    await expect(
      acceptWorkspaceInvite(envWith(harness.db), {
        token: invite.ok ? invite.token : "",
        userId: "member-1",
        userEmail: "member@x.com",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite
        .prepare("SELECT status FROM invitation WHERE email = 'member@x.com'")
        .get(),
    ).toMatchObject({ status: "pending" });
    expect(
      harness.sqlite
        .prepare("SELECT COUNT(*) AS count FROM member WHERE organizationId = 'org_agency-owner' AND role = 'member'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("accepts a valid invite while preserving the member transition", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);

    await expect(
      acceptWorkspaceInvite(envWith(harness.db), {
        token: invite.ok ? invite.token : "",
        userId: "member-1",
        userEmail: "member@x.com",
      }),
    ).resolves.toEqual({ ok: true, ownerName: "Asha" });
    expect(
      harness.sqlite
        .prepare("SELECT status, tokenHash FROM invitation WHERE email = 'member@x.com'")
        .get(),
    ).toMatchObject({ status: "accepted", tokenHash: null });
    expect(
      harness.sqlite
        .prepare("SELECT userId, role FROM member WHERE organizationId = 'org_agency-owner' AND role = 'member'")
        .get(),
    ).toMatchObject({ userId: "member-1", role: "member" });
  });

  it("does not let an existing workspace owner accept another workspace invite", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO user_plan (user_id, plan) VALUES ('member-1', 'starter');
      INSERT INTO invitation (id, organizationId, email, role, status, createdAt, inviterId)
      VALUES ('owned-seat', 'org_member-1', 'member2@x.com', 'member', 'pending', datetime('now'), 'member-1');
    `);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);

    await expect(
      acceptWorkspaceInvite(envWith(harness.db), {
        token: invite.ok ? invite.token : "",
        userId: "member-1",
        userEmail: "member@x.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "You already own a workspace — leave it before joining another." });
  });

  it("rejects an invite whose expiry passed earlier today", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });
    expect(invite.ok).toBe(true);
    harness.sqlite.exec(
      "UPDATE invitation SET expiresAt = datetime('now', '-1 minute') WHERE email = 'member@x.com'",
    );

    await expect(
      acceptWorkspaceInvite(envWith(harness.db), {
        token: invite.ok ? invite.token : "",
        userId: "member-1",
        userEmail: "member@x.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "This invite has expired — ask for a fresh one." });
  });

  it("reports stale revoke and resend transitions instead of false success", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO invitation (id, organizationId, email, role, status, createdAt, inviterId)
      VALUES ('pending', 'org_agency-owner', 'member@x.com', 'member', 'pending', datetime('now'), 'agency-owner');
    `);

    await expect(
      revokeWorkspaceMember(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: "pending",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      revokeWorkspaceMember(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: "pending",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: "pending",
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("enforces the one-teammate-seat-per-user invariant across workspaces", () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);

    const index = harness.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_member_teammate_seat'")
      .get() as { sql: string } | undefined;
    expect(index?.sql).toContain("role = 'member'");

    harness.sqlite.exec(`
      INSERT INTO member (id, organizationId, userId, role, createdAt)
      VALUES ('m-1', 'org_agency-owner', 'member-1', 'member', datetime('now'));
    `);
    expect(() =>
      harness.sqlite.exec(`
        INSERT INTO member (id, organizationId, userId, role, createdAt)
        VALUES ('m-2', 'org_agency-other', 'member-1', 'member', datetime('now'));
      `),
    ).toThrow();
  });
});
