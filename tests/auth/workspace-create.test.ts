import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

const reschedule = vi.hoisted(() => vi.fn(() => Promise.resolve({ cancelledId: null, createdId: null })));
vi.mock("../../app/lib/standing/reschedule.server", () => ({ rescheduleBriefSchedule: reschedule }));

import { timezoneCookie, timezoneCookieValue } from "../../app/lib/timezone";
import {
  ensureWorkspace,
  ensureWorkspaceForSignIn,
  firstWorkspaceId,
  workspaceLanding,
  workspaceNameFromEmail,
  type WorkspaceDb,
} from "../../app/lib/workspace.server";

function openDb(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      brief_weekday INTEGER NOT NULL DEFAULT 1 CHECK (brief_weekday BETWEEN 0 AND 6),
      brief_hour INTEGER NOT NULL DEFAULT 8 CHECK (brief_hour BETWEEN 0 AND 23),
      created_at TEXT NOT NULL,
      fixture INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (owner_user_id) REFERENCES "user"(id)
    );
    CREATE INDEX idx_workspace_owner ON workspace(owner_user_id);
    CREATE TABLE channel (id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL UNIQUE, is_enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO channel (id, key) VALUES ('chan-email', 'email');
    CREATE TABLE send_target (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      target_value TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, channel_id, target_value)
    );
    CREATE TABLE entity (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      role TEXT NOT NULL,
      domain TEXT,
      name TEXT,
      identity_json TEXT,
      origin TEXT,
      confirmed_at TEXT,
      state TEXT,
      created_at TEXT
    );
    CREATE TABLE onboarding_run (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      input_raw TEXT NOT NULL,
      started_at TEXT NOT NULL,
      watching_started_at TEXT
    );
    CREATE TABLE plan (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'trialing',
      current_period_end TEXT
    );
  `);
  return database;
}

function asWorkspaceDb(database: DatabaseSync): WorkspaceDb {
  return {
    prepare(query: string) {
      const statement = database.prepare(query);
      return {
        bind(...values: unknown[]) {
          const params = values.map((value) => (value === undefined ? null : value)) as (string | number | null)[];
          return {
            async first<T>() {
              const row = statement.get(...params) as T | undefined;
              return row ?? null;
            },
            async run() {
              const result = statement.run(...params);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
  };
}

function countOf(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as { n: number };
  return row.n;
}

function seedUser(database: DatabaseSync, id: string, email: string) {
  database.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run(id, email);
}

async function cookieHeader(zone: string): Promise<string> {
  const baked = await timezoneCookie.serialize(zone);
  const pair = baked.split(";")[0];
  if (!pair) throw new Error("cookie serialize returned no pair");
  return pair;
}

describe("workspaceNameFromEmail", () => {
  it("uses the local part and nothing after the @", () => {
    expect(workspaceNameFromEmail("Ada.Lovelace@Example.com")).toBe("Ada.Lovelace");
  });
});

describe("timezoneCookieValue", () => {
  it("reads the zone createCookie wrote and rejects a header it cannot decode", async () => {
    expect(await timezoneCookieValue(await cookieHeader("America/Los_Angeles"))).toBe("America/Los_Angeles");
    expect(await timezoneCookieValue("timezone=Not%2FAZone")).toBeNull();
    expect(await timezoneCookieValue(null)).toBeNull();
  });
});

describe("ensureWorkspace", () => {
  it("creates one workspace and no entity or plan row", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const db = asWorkspaceDb(database);
    const row = await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: "Asia/Kolkata",
      now: "2026-09-22T12:00:00.000Z",
    });

    expect(row).toMatchObject({
      id: firstWorkspaceId("user-1"),
      name: "ada",
      owner_user_id: "user-1",
      timezone: "Asia/Kolkata",
      brief_weekday: 1,
      brief_hour: 8,
      created_at: "2026-09-22T12:00:00.000Z",
    });
    expect(countOf(database, "SELECT count(*) AS n FROM workspace")).toBe(1);

    const again = await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: "UTC",
      now: "2026-09-23T00:00:00.000Z",
    });
    expect(again.id).toBe(row.id);
    expect(again.timezone).toBe("Asia/Kolkata");
    expect(again.created_at).toBe("2026-09-22T12:00:00.000Z");
    expect(countOf(database, "SELECT count(*) AS n FROM workspace")).toBe(1);
  });

  it("stores UTC when the browser sent no zone, then keeps the first real zone", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const db = asWorkspaceDb(database);
    const created = await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: null,
      now: "2026-09-22T12:00:00.000Z",
    });
    expect(created.timezone).toBe("UTC");

    const filled = await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: "Asia/Kolkata",
      now: "2026-09-22T12:05:00.000Z",
    });
    expect(filled.id).toBe(created.id);
    expect(filled.timezone).toBe("Asia/Kolkata");

    const kept = await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: "Europe/London",
      now: "2026-09-22T12:06:00.000Z",
    });
    expect(kept.timezone).toBe("Asia/Kolkata");
    expect(countOf(database, "SELECT count(*) AS n FROM workspace")).toBe(1);
  });

  it("reschedules the rollover once when the captured zone changes the schedule (0509#7075)", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const db = asWorkspaceDb(database);
    reschedule.mockClear();
    const input = { userId: "user-1", email: "ada@example.com", now: "2026-10-11T10:00:00.000Z" };
    await ensureWorkspace(db, { ...input, timezone: null });
    await ensureWorkspace(db, { ...input, timezone: "UTC" });
    expect(reschedule).not.toHaveBeenCalled();

    await ensureWorkspace(db, { ...input, timezone: "Asia/Kolkata" });
    await ensureWorkspace(db, { ...input, timezone: "Europe/London" });

    expect(reschedule).toHaveBeenCalledTimes(1);
    expect(reschedule).toHaveBeenCalledWith(
      firstWorkspaceId("user-1"),
      { timezone: "UTC", weekday: 1, hour: 8 },
      { timezone: "Asia/Kolkata", weekday: 1, hour: 8 },
    );
  });

  it("a failed reschedule leaves the zone unset so the next sign-in retries and recovers (0509#7075)", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const db = asWorkspaceDb(database);
    const input = { userId: "user-1", email: "ada@example.com", now: "2026-10-11T10:00:00.000Z" };
    await ensureWorkspace(db, { ...input, timezone: null });
    reschedule.mockClear();
    reschedule.mockRejectedValueOnce(new Error("workflow binding unavailable"));

    await expect(ensureWorkspace(db, { ...input, timezone: "Asia/Kolkata" })).rejects.toThrow(
      "workflow binding unavailable",
    );
    const stored = database.prepare("SELECT timezone FROM workspace").get() as { timezone: string };
    expect(stored.timezone).toBe("UTC");

    const recovered = await ensureWorkspace(db, { ...input, timezone: "Asia/Kolkata" });

    expect(recovered.timezone).toBe("Asia/Kolkata");
    expect(reschedule).toHaveBeenCalledTimes(2);
    const settled = database.prepare("SELECT timezone FROM workspace").get() as { timezone: string };
    expect(settled.timezone).toBe("Asia/Kolkata");
  });

  it("a failing revert does not mask the original reschedule error (0509#7075)", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const base = asWorkspaceDb(database);
    const db: WorkspaceDb = {
      prepare(query: string) {
        if (query.startsWith("UPDATE workspace SET timezone = 'UTC'")) throw new Error("d1 unavailable");
        return base.prepare(query);
      },
    };
    const input = { userId: "user-1", email: "ada@example.com", now: "2026-10-11T10:00:00.000Z" };
    await ensureWorkspace(db, { ...input, timezone: null });
    reschedule.mockRejectedValueOnce(new Error("workflow binding unavailable"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(ensureWorkspace(db, { ...input, timezone: "Asia/Kolkata" })).rejects.toThrow(
      "workflow binding unavailable",
    );

    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain("workspace.timezone_revert_failed");
    logged.mockRestore();
  });

  it("a losing concurrent fill neither reschedules nor reverts the winner's zone (0509#7075)", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const base = asWorkspaceDb(database);
    const input = { userId: "user-1", email: "ada@example.com", now: "2026-10-11T10:00:00.000Z" };
    await ensureWorkspace(base, { ...input, timezone: null });
    const racing: WorkspaceDb = {
      prepare(query: string) {
        if (query.startsWith("SELECT id, name")) {
          return {
            bind: () => ({
              first: async <T>() =>
                ({
                  id: "ws_user-1",
                  name: "ada",
                  owner_user_id: "user-1",
                  timezone: "UTC",
                  brief_weekday: 1,
                  brief_hour: 8,
                  created_at: input.now,
                }) as T,
              run: async () => ({ meta: { changes: 0 } }),
            }),
          };
        }
        return base.prepare(query);
      },
    };
    database.prepare("UPDATE workspace SET timezone = 'Europe/London'").run();
    reschedule.mockClear();
    reschedule.mockRejectedValueOnce(new Error("must not be called"));

    const result = await ensureWorkspace(racing, { ...input, timezone: "Asia/Kolkata" });

    expect(result.timezone).toBe("UTC");
    expect(reschedule).not.toHaveBeenCalled();
    const stored = database.prepare("SELECT timezone FROM workspace").get() as { timezone: string };
    expect(stored.timezone).toBe("Europe/London");
    reschedule.mockReset();
    reschedule.mockResolvedValue({ cancelledId: null, createdId: null });
  });

  it("a concurrent second request does not create a second workspace", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const base = asWorkspaceDb(database);
    const racing: WorkspaceDb = {
      prepare(query: string) {
        const statement = base.prepare(query);
        return {
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              first: bound.first.bind(bound),
              async run() {
                if (query.startsWith("INSERT INTO workspace")) {
                  entered += 1;
                  if (entered === 1) await gate;
                  else release();
                }
                await bound.run();
              },
            };
          },
        };
      },
    };

    const [first, second] = await Promise.all([
      ensureWorkspace(racing, {
        userId: "user-1",
        email: "ada@example.com",
        timezone: "America/New_York",
        now: "2026-09-22T12:00:00.000Z",
      }),
      ensureWorkspace(racing, {
        userId: "user-1",
        email: "ada@example.com",
        timezone: "America/New_York",
        now: "2026-09-22T12:00:01.000Z",
      }),
    ]);

    expect(entered).toBe(2);
    expect(first.id).toBe(firstWorkspaceId("user-1"));
    expect(second.id).toBe(first.id);
    expect(countOf(database, "SELECT count(*) AS n FROM workspace")).toBe(1);
  });

  it("a second insert of the first workspace id is a no-op", () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const id = firstWorkspaceId("user-1");
    const insert = database.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'ada', 'user-1', 'UTC', 1, 8, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    insert.run(id, "2026-09-22T12:00:00.000Z");
    insert.run(id, "2026-09-22T12:00:01.000Z");
    expect(countOf(database, "SELECT count(*) AS n FROM workspace")).toBe(1);
  });

  it("the sign-in hook path takes the email off the user row and the zone off the request", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const request = new Request("https://0509.io/api/auth/magic-link/verify", {
      headers: { cookie: await cookieHeader("Europe/London") },
    });
    const row = await ensureWorkspaceForSignIn(asWorkspaceDb(database), {
      userId: "user-1",
      request,
      now: "2026-09-22T12:00:00.000Z",
    });
    expect(row).toMatchObject({
      id: firstWorkspaceId("user-1"),
      name: "ada",
      owner_user_id: "user-1",
      timezone: "Europe/London",
      brief_weekday: 1,
      brief_hour: 8,
    });
    expect(await ensureWorkspaceForSignIn(asWorkspaceDb(database), { userId: "missing", request })).toBeNull();
  });

  it("the sign-in hook gives the workspace exactly one email target, the owner's address", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const request = new Request("https://0509.io/api/auth/magic-link/verify");
    const signIn = () =>
      ensureWorkspaceForSignIn(asWorkspaceDb(database), { userId: "user-1", request, now: "2026-09-22T12:00:00.000Z" });
    await signIn();
    await signIn();
    expect(
      database.prepare("SELECT workspace_id, channel_id, target_value, is_verified FROM send_target").all(),
    ).toEqual([
      {
        workspace_id: firstWorkspaceId("user-1"),
        channel_id: "chan-email",
        target_value: "ada@example.com",
        is_verified: 1,
      },
    ]);
  });

  it("returns the row the other request wrote when the insert fails", async () => {
    const row = {
      id: firstWorkspaceId("user-1"),
      name: "ada",
      owner_user_id: "user-1",
      timezone: "UTC",
      brief_weekday: 1,
      brief_hour: 8,
      created_at: "2026-09-22T12:00:00.000Z",
    };
    let reads = 0;
    const db: WorkspaceDb = {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first<T>() {
                if (!query.startsWith("SELECT")) return null;
                reads += 1;
                return (reads === 1 ? null : row) as T | null;
              },
              async run() {
                throw new Error("busy");
              },
            };
          },
        };
      },
    };

    await expect(
      ensureWorkspace(db, {
        userId: "user-1",
        email: "ada@example.com",
        timezone: "UTC",
        now: "2026-09-22T12:00:00.000Z",
      }),
    ).resolves.toEqual(row);
  });
});

describe("workspaceLanding", () => {
  it("does not insert when the owner has no workspace", async () => {
    const queries: string[] = [];
    const db: WorkspaceDb = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async first<T>() {
                return null as T | null;
              },
              async run() {
                throw new Error("workspaceLanding must not write");
              },
            };
          },
        };
      },
    };

    await expect(
      workspaceLanding(db, {
        userId: "user-gone",
        timezone: "Asia/Kolkata",
      }),
    ).resolves.toEqual({ workspaceId: null, landing: null });
    expect(queries.some((query) => query.includes("INSERT"))).toBe(false);
  });

  it("fills UTC from the landing read when a real zone arrives", async () => {
    const database = openDb();
    seedUser(database, "user-1", "ada@example.com");
    const db = asWorkspaceDb(database);
    await ensureWorkspace(db, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: null,
      now: "2026-09-22T12:00:00.000Z",
    });
    await expect(workspaceLanding(db, { userId: "user-1", timezone: "Asia/Kolkata" })).resolves.toEqual({
      workspaceId: firstWorkspaceId("user-1"),
      landing: "/onboarding",
    });
    expect(database.prepare("SELECT timezone FROM workspace WHERE owner_user_id = 'user-1'").get()).toEqual({
      timezone: "Asia/Kolkata",
    });
  });
});
