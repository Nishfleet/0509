import { describe, expect, it, vi } from "vitest";

import {
  AGENCY_SEAT_LIMIT,
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  resendWorkspaceInvite,
  resolveWorkspace,
} from "~/lib/workspace.server";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(async (_env: unknown, userId: string) =>
    userId.startsWith("agency") ? "agency" : "starter",
  ),
}));

interface FakeRow {
  [key: string]: unknown;
}

function fakeDb(state: { firstResults?: FakeRow[]; allResults?: FakeRow[] } = {}) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings });
          return {
            first: async () => (state.firstResults ?? []).shift() ?? null,
            all: async () => ({ results: state.allResults ?? [] }),
            run: async () => ({}),
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
});
