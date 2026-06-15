import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createShareLink,
  deactivateWatchlistsBeyondPlanLimit,
  getShareLink,
  listActiveShareLinks,
  revokeShareLink,
  SHARE_LINK_DEFAULT_TTL_DAYS,
} from "~/lib/data.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
} as never;

function createCapturingDb(rows: unknown[] = [], changes = 1) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes } };
              },
              async all<T>() {
                return { results: rows as T[] };
              },
            };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/env.server");
});

describe("share link persistence", () => {
  it("stamps new share links with the default 90-day expiry", async () => {
    const mock = createCapturingDb();
    const before = Date.now();

    const share = await createShareLink({ DB: mock.db } as never, session, {
      resourceType: "collection",
      resourceId: "collection-1",
      isSnapshot: false,
    });

    expect(share.expiresAt).toBeTruthy();
    const expiresMs = new Date(share.expiresAt!).getTime() - before;
    const expectedMs = SHARE_LINK_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(60 * 1000);

    const insert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO share_link"),
    );
    expect(insert?.sql).toContain("expires_at");
    expect(insert?.bindings).toContain(share.expiresAt);
  });

  it("only resolves tokens that are unrevoked and unexpired", async () => {
    const mock = createCapturingDb([]);

    const result = await getShareLink({ DB: mock.db } as never, "token-1");

    expect(result).toBeNull();
    const select = mock.statements.find((statement) => statement.sql.includes("FROM share_link"));
    expect(select?.sql).toContain("revoked_at IS NULL");
    expect(select?.sql).toContain("expires_at IS NULL OR expires_at >");
    expect(select?.bindings[0]).toBe("token-1");
  });

  it("treats legacy NULL expiry as still valid", async () => {
    const mock = createCapturingDb([
      {
        id: "share-1",
        token: "token-1",
        user_id: "user-1",
        resource_type: "watchlist",
        resource_id: "watch-1",
        is_snapshot: 0,
        snapshot_payload_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: null,
        revoked_at: null,
      },
    ]);

    const result = await getShareLink({ DB: mock.db } as never, "token-1");

    expect(result).toMatchObject({ id: "share-1", expiresAt: null, revokedAt: null });
  });

  it("revokes only the owner's link and reports whether anything changed", async () => {
    const mock = createCapturingDb([], 1);

    const revoked = await revokeShareLink({ DB: mock.db } as never, "user-1", "share-1");

    expect(revoked).toBe(true);
    const update = mock.statements.find((statement) => statement.sql.includes("UPDATE share_link"));
    expect(update?.sql).toContain("AND user_id = ?");
    expect(update?.sql).toContain("revoked_at IS NULL");
    expect(update?.bindings.slice(1)).toEqual(["share-1", "user-1"]);

    const noChange = createCapturingDb([], 0);
    expect(await revokeShareLink({ DB: noChange.db } as never, "user-2", "share-1")).toBe(false);
  });

  it("lists only the user's active links", async () => {
    const mock = createCapturingDb([]);

    await listActiveShareLinks({ DB: mock.db } as never, "user-1");

    const select = mock.statements.find((statement) => statement.sql.includes("FROM share_link"));
    expect(select?.sql).toContain("WHERE user_id = ?");
    expect(select?.sql).toContain("revoked_at IS NULL");
    expect(select?.bindings[0]).toBe("user-1");
  });
});

describe("deactivateWatchlistsBeyondPlanLimit", () => {
  it("pauses everything past the new plan's limit, keeping the newest active", async () => {
    const mock = createCapturingDb([], 4);

    const changed = await deactivateWatchlistsBeyondPlanLimit(
      { DB: mock.db } as never,
      "user-1",
      3,
    );

    expect(changed).toBe(4);
    const update = mock.statements.find((statement) => statement.sql.includes("UPDATE watchlist"));
    expect(update?.sql).toContain("SET is_active = 0");
    expect(update?.sql).toContain("ORDER BY created_at DESC");
    expect(update?.sql).toContain("LIMIT ?");
    expect(update?.bindings.slice(1)).toEqual(["user-1", "user-1", 3]);
  });
});

describe("/app/shares route", () => {
  it("lists active share links with absolute URLs", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: "user-1",
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/env.server", () => ({
      appOrigin: vi.fn(() => "https://0509.io"),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listActiveShareLinks: vi.fn().mockResolvedValue([
        {
          id: "share-1",
          token: "token-abc",
          userId: "user-1",
          resourceType: "collection",
          resourceId: "collection-1",
          isSnapshot: true,
          snapshotPayload: null,
          createdAt: "2026-06-01T00:00:00.000Z",
          expiresAt: "2026-09-01T00:00:00.000Z",
          revokedAt: null,
        },
      ]),
      revokeShareLink: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.shares");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/shares"),
      params: {},
    } as never);

    expect(result.shares).toEqual([
      {
        id: "share-1",
        url: "https://0509.io/share/token-abc",
        resourceLabel: "Board",
        mode: "Snapshot",
        createdAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("revokes a link through the action with the session user's scope", async () => {
    const revokeShareLinkMock = vi.fn().mockResolvedValue(true);
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: "user-1",
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listActiveShareLinks: vi.fn(),
      revokeShareLink: revokeShareLinkMock,
    }));

    const { action } = await import("~/routes/app.shares");
    const body = new URLSearchParams({ intent: "revoke-share", shareLinkId: "share-1" });
    const result = await action({
      context: {},
      request: new Request("https://0509.io/app/shares", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
      params: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(revokeShareLinkMock).toHaveBeenCalledWith(expect.anything(), "user-1", "share-1");
  });
});
