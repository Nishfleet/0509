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
  `);
  return harness;
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
          status: "invited",
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
    const update = calls.find((call) => call.sql.includes("UPDATE workspace_member"));
    expect(update?.sql).toContain("token_expires_at");
    expect(update?.bindings[2]).toBe("member-1");
    expect(update?.bindings[3]).toBe("agency-owner");
  });

  it("does not report an invite insert that changed zero rows as success", async () => {
    const { db } = fakeDb({ runChanges: 0 });
    await expect(
      createWorkspaceInvite(envWith(db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "new@x.com",
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("does not resend active member rows", async () => {
    const { db } = fakeDb({
      firstResults: [
        {
          id: "member-1",
          invitedEmail: "member@x.com",
          status: "active",
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
          ownerUserId: "agency-owner",
          invitedEmail: "member@x.com",
          tokenExpiresAt: null,
          status: "invited",
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
          ownerUserId: "agency-owner",
          invitedEmail: "right@x.com",
          tokenExpiresAt: null,
          status: "invited",
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
      INSERT INTO workspace_member (id, owner_user_id, invited_email, status)
      VALUES ('existing', 'agency-owner', 'existing@x.com', 'invited');
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
    expect(
      harness.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM workspace_member WHERE owner_user_id = 'agency-owner' AND status IN ('invited', 'active')",
        )
        .get(),
    ).toMatchObject({ count: 2 });
  });

  it("does not count expired pending invitations as occupied seats", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('expired-seat', 'agency-owner', 'expired@x.com', 'invited', 'expired-token', datetime('now', '-1 minute')),
        ('live-seat', 'agency-owner', 'live@x.com', 'invited', 'live-token', datetime('now', '+1 day'));
    `);

    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "new@x.com",
    });

    expect(invite.ok).toBe(true);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_member WHERE owner_user_id = 'agency-owner'").get(),
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
      "UPDATE workspace_member SET token_expires_at = datetime('now', '-1 minute') WHERE invited_email = 'member@x.com'",
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
      .prepare("SELECT token_expires_at AS tokenExpiresAt FROM workspace_member WHERE id = ?")
      .get(members[0]!.id) as { tokenExpiresAt: string };
    expect(Date.parse(refreshed.tokenExpiresAt)).toBeGreaterThan(Date.now());
  });

  it("does not let an expired invite in another workspace lock an email forever", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('expired-other', 'agency-other', 'member@x.com', 'invited', 'old-token', datetime('now', '-1 minute'));
    `);

    const invite = await createWorkspaceInvite(envWith(harness.db), {
      ownerUserId: "agency-owner",
      ownerEmail: "owner@x.com",
      inviteeEmail: "member@x.com",
    });

    expect(invite.ok).toBe(true);
    expect(
      harness.sqlite
        .prepare("SELECT owner_user_id FROM workspace_member WHERE invited_email = 'member@x.com' ORDER BY owner_user_id")
        .all(),
    ).toEqual([{ owner_user_id: "agency-other" }, { owner_user_id: "agency-owner" }]);
  });

  it("still blocks an email with a live invitation in another workspace", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('live-other', 'agency-other', 'member@x.com', 'invited', 'live-token', datetime('now', '+1 day'));
    `);

    await expect(
      createWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        ownerEmail: "owner@x.com",
        inviteeEmail: "member@x.com",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_member WHERE invited_email = 'member@x.com'").get(),
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
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_member WHERE invited_email = 'member@x.com'").get(),
    ).toEqual({ count: 1 });
  });

  it("does not resurrect an expired invite while another workspace has a live one", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('expired-other', 'agency-other', 'member@x.com', 'invited', 'old-token', datetime('now', '-1 minute'));
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
      harness.sqlite.prepare("SELECT token_hash FROM workspace_member WHERE id = 'expired-other'").get(),
    ).toEqual({ token_hash: "old-token" });
  });

  it("does not resend an expired invite to an email that is already an active member", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, member_user_id, invited_email, status, token_hash, token_expires_at, accepted_at)
      VALUES
        ('active-member', 'agency-owner', 'member-1', 'old-member@x.com', 'active', NULL, NULL, datetime('now'));
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('expired-other', 'agency-other', 'member@x.com', 'invited', 'old-token', datetime('now', '-1 minute'));
    `);

    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-other",
        memberRowId: "expired-other",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT token_hash FROM workspace_member WHERE id = 'expired-other'").get(),
    ).toEqual({ token_hash: "old-token" });
  });

  it("does not resend an expired invitation after its seat has been reallocated", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, invited_email, status, token_hash, token_expires_at)
      VALUES
        ('expired-seat', 'agency-owner', 'expired@x.com', 'invited', 'expired-token', datetime('now', '-1 minute')),
        ('live-seat-1', 'agency-owner', 'live1@x.com', 'invited', 'live-token-1', datetime('now', '+1 day')),
        ('live-seat-2', 'agency-owner', 'live2@x.com', 'invited', 'live-token-2', datetime('now', '+1 day'));
    `);

    await expect(
      resendWorkspaceInvite(envWith(harness.db), {
        ownerUserId: "agency-owner",
        memberRowId: "expired-seat",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      harness.sqlite.prepare("SELECT token_hash FROM workspace_member WHERE id = 'expired-seat'").get(),
    ).toEqual({ token_hash: "expired-token" });
  });

  it("fails closed when duplicate active memberships exist", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO workspace_member
        (id, owner_user_id, member_user_id, invited_email, status, accepted_at)
      VALUES
        ('m-1', 'agency-owner', 'member-1', 'member@x.com', 'active', datetime('now')),
        ('m-2', 'agency-owner', 'member-1', 'member2@x.com', 'active', datetime('now'));
    `);

    await expect(resolveWorkspace(envWith(harness.db), "member-1")).resolves.toEqual({
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
        .prepare("SELECT status, member_user_id FROM workspace_member WHERE invited_email = 'member@x.com'")
        .get(),
    ).toMatchObject({ status: "invited", member_user_id: null });
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
        .prepare("SELECT status, member_user_id, token_hash FROM workspace_member WHERE invited_email = 'member@x.com'")
        .get(),
    ).toMatchObject({ status: "active", member_user_id: "member-1", token_hash: null });
  });

  it("does not let an existing workspace owner accept another workspace invite", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    harness.sqlite.exec(`
      INSERT INTO user_plan (user_id, plan) VALUES ('member-1', 'starter');
      INSERT INTO workspace_member (id, owner_user_id, invited_email, status)
      VALUES ('owned-seat', 'member-1', 'member2@x.com', 'invited');
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
      "UPDATE workspace_member SET token_expires_at = datetime('now', '-1 minute') WHERE invited_email = 'member@x.com'",
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
      INSERT INTO workspace_member (id, owner_user_id, invited_email, status)
      VALUES ('pending', 'agency-owner', 'member@x.com', 'invited');
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

  it("installs the active member uniqueness invariant without repairing rows", async () => {
    const harness = workspaceSqlite();
    sqliteFixtures.push(harness);
    applyMigration(harness.sqlite, "migrations/0067_workspace_member_invariants.sql");

    const index = harness.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_workspace_member_active_member'")
      .get() as { sql: string } | undefined;
    expect(index?.sql).toContain("WHERE status = 'active' AND member_user_id IS NOT NULL");
  });
});
