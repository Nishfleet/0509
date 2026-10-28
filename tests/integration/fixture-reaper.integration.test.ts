import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_REAPER_CEILING,
  reapFixtureAccounts,
  reaperMode,
  startFixtureReaper,
} from "../../app/lib/fixture-reaper.server";
import type { ReaperStep } from "../../app/lib/fixture-reaper.server";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const OLD = "2026-10-01T12:00:00.000Z";
const YOUNG = "2026-10-21T11:00:00.000Z";

const direct: ReaperStep = (_name, work) => work();

interface Seed {
  id: string;
  email: string;
  createdAt?: string;
  fixture?: 0 | 1;
  plan?: boolean;
  child?: { fixture: 0 | 1; plan?: boolean; ownerId?: string };
  watch?: boolean;
  key?: boolean;
}

async function seed(options: Seed): Promise<{ workspaceId: string; watchId: string }> {
  const { id, email, createdAt = OLD, fixture = 1, plan = false, child, watch = false, key = false } = options;
  const workspaceId = `ws-${id}`;
  const watchId = `watch-${id}`;
  const statements = [
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(id, email, createdAt),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture) VALUES (?1, 'Acme', ?2, 'UTC', 1, 8, ?3, ?4)",
    ).bind(workspaceId, id, createdAt, fixture),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, state, domain, created_at) VALUES (?1, ?2, 'self', 'on', ?3, ?4)",
    ).bind(`ent-${id}`, workspaceId, `${id}.example.com`, createdAt),
  ];
  if (plan) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?1, ?2, 'scout', 'trialing', ?3)",
      ).bind(`plan-${id}`, workspaceId, createdAt),
    );
  }
  if (watch) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, (SELECT id FROM source LIMIT 1), ?3)",
      ).bind(watchId, `ent-${id}`, `${id}.example.com`),
    );
  }
  if (key) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO apikey (id, configId, referenceId, \"key\", createdAt, updatedAt) VALUES (?1, 'default', ?2, ?1, ?3, ?3)",
      ).bind(`key-${id}`, id, createdAt),
    );
  }
  if (child !== undefined) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture, parent_workspace_id) VALUES (?1, 'Client', ?2, 'UTC', 1, 8, ?3, ?4, ?5)",
      ).bind(`wc-${id}`, child.ownerId ?? id, createdAt, child.fixture, workspaceId),
    );
    if (child.plan === true) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?1, ?2, 'scout', 'trialing', ?3)",
        ).bind(`plan-c-${id}`, `wc-${id}`, createdAt),
      );
    }
  }
  await env.DB.batch(statements);
  return { workspaceId, watchId };
}

const count = async (sql: string, ...values: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...values)
      .first<{ n: number }>()
  )?.n ?? -1;

const userExists = async (id: string) => (await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?', id)) === 1;

async function instanceMissing(id: string): Promise<boolean> {
  try {
    await (await env.ACCOUNT_DELETE.get(id)).status();
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("instance.not_found");
  }
}

describe("the e2e fixture account reaper", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM apikey");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    vi.restoreAllMocks();
  });

  it("only the exact value live arms it", () => {
    expect(reaperMode("live")).toBe("live");
    for (const raw of [undefined, null, "", "dry-run", "junk", "LIVE", " live", "live ", "true", 1]) {
      expect(reaperMode(raw)).toBe("dry-run");
    }
  });

  it("never touches real users, non-fixture workspaces, planned accounts, kept accounts or accounts younger than a day", async () => {
    const protectedIds = [
      { id: "u-real", email: "ada@example.com", fixture: 1 as const },
      { id: "u-real-ws", email: "grace@example.com", fixture: 0 as const },
      { id: "u-pattern-ws0", email: "e2e+abc123@0509.io", fixture: 0 as const },
      { id: "u-planned", email: "e2e+planned@0509.io", plan: true },
      { id: "u-kept-j7", email: "e2e+j7@0509.io" },
      { id: "u-kept-soak", email: "E2E+SOAK@0509.io" },
      { id: "u-kept-j11", email: "e2e+j11@0509.io" },
      { id: "u-young", email: "e2e+young@0509.io", createdAt: YOUNG },
      { id: "u-other-domain", email: "e2e+x@gmail.com" },
      { id: "u-lookalike", email: "e2e+x@acme-e2e.test" },
      { id: "u-child-ws0", email: "e2e+child0@0509.io", child: { fixture: 0 as const } },
      { id: "u-child-plan", email: "e2e+childplan@0509.io", child: { fixture: 1 as const, plan: true } },
    ];
    await Promise.all(protectedIds.map((options) => seed({ ...options, watch: true, key: true })));

    const live = await reapFixtureAccounts("live", NOW, direct);

    expect(live).toMatchObject({ mode: "live", selected: 0, deleted: 0, ceilingHit: false });
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(protectedIds.length);
    expect(await count("SELECT COUNT(*) AS n FROM workspace")).toBe(protectedIds.length + 2);
    expect(await count("SELECT COUNT(*) AS n FROM apikey")).toBe(protectedIds.length);
    expect(await count("SELECT COUNT(*) AS n FROM watch")).toBe(protectedIds.length);
  });

  it.each([undefined, "", "junk", "LIVE", "dry-run"])(
    "deletes nothing and still reports the counts when the mode is %j",
    async (raw) => {
      await seed({ id: "u-a", email: "e2e+a@0509.io", watch: true, key: true, child: { fixture: 1 } });
      await seed({ id: "u-b", email: "e2e+b@0509.io", watch: true, key: true });
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const report = await reapFixtureAccounts(raw, NOW, direct);

      expect(report).toEqual({
        mode: "dry-run",
        selected: 2,
        workspaces: 3,
        entities: 2,
        prefixes: 9,
        deleted: 0,
        ceilingHit: false,
      });
      expect(await userExists("u-a")).toBe(true);
      expect(await userExists("u-b")).toBe(true);
      expect(await count("SELECT COUNT(*) AS n FROM workspace")).toBe(3);
      expect(await count("SELECT COUNT(*) AS n FROM apikey")).toBe(2);
      expect(await instanceMissing("fixture-reaper-u-a")).toBe(true);
      expect(await instanceMissing("fixture-reaper-u-b")).toBe(true);
      const line = log.mock.calls.map(([text]) => String(text)).find((text) => text.includes("fixture_reaper.run"));
      expect(JSON.parse(line ?? "{}")).toEqual({ event: "fixture_reaper.run", ...report });
      expect(line).not.toContain("@");
      expect(line).not.toContain("u-a");
    },
  );

  it("live: deletes the selected accounts, cascades their rows and keys, and starts the file cleanup with their prefixes", async () => {
    const mine = await seed({ id: "u-gone", email: "e2e+gone@0509.io", watch: true, key: true, child: { fixture: 1 } });
    const staying = await seed({ id: "u-stays", email: "e2e+young@0509.io", createdAt: YOUNG, watch: true, key: true });
    await env.SNAPSHOTS.put(`snapshot/site/${mine.watchId}/1.txt`, "a");
    await env.SNAPSHOTS.put(`snapshot/hiring/${mine.watchId}/1.json`, "b");
    await env.SNAPSHOTS.put(`snapshot/site/${staying.watchId}/1.txt`, "c");
    await env.SNAPSHOTS_BACKUP.put(`snapshot/site/${mine.watchId}/1.txt`, "a");
    await env.SNAPSHOTS_BACKUP.put(`snapshot/site/${staying.watchId}/1.txt`, "c");
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, "fixture-reaper-u-gone");

    const report = await reapFixtureAccounts("live", NOW, direct);

    expect(report).toEqual({
      mode: "live",
      selected: 1,
      workspaces: 2,
      entities: 1,
      prefixes: 5,
      deleted: 1,
      ceilingHit: false,
    });
    expect(await userExists("u-gone")).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM workspace WHERE owner_user_id = 'u-gone'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ?", mine.workspaceId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM watch WHERE id = ?", mine.watchId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM apikey WHERE referenceId = 'u-gone'")).toBe(0);
    expect(await userExists("u-stays")).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM apikey WHERE referenceId = 'u-stays'")).toBe(1);

    await introspector.waitForStatus("complete");
    expect(await instanceMissing("fixture-reaper-u-gone")).toBe(false);
    expect(await introspector.getOutput()).toEqual({ deleted: 2 });
    expect((await env.SNAPSHOTS.list()).objects.map((object) => object.key)).toEqual([
      `snapshot/site/${staying.watchId}/1.txt`,
    ]);
    expect((await env.SNAPSHOTS_BACKUP.list()).objects.map((object) => object.key)).toEqual([
      `snapshot/site/${staying.watchId}/1.txt`,
    ]);
  });

  it("live: removes the files of a child workspace that a different user owns", async () => {
    await seed({ id: "u-foreign", email: "foreign@example.com", createdAt: YOUNG });
    await seed({
      id: "u-parent",
      email: "e2e+parent@0509.io",
      child: { fixture: 1, ownerId: "u-foreign" },
    });
    await env.SNAPSHOTS.put("card/wc-u-parent/1.png", "x");
    await env.SNAPSHOTS.put("card/ws-u-foreign/1.png", "y");
    await using introspector = await introspectWorkflowInstance(env.ACCOUNT_DELETE, "fixture-reaper-u-parent");

    const report = await reapFixtureAccounts("live", NOW, direct);

    expect(report).toMatchObject({ selected: 1, workspaces: 2, prefixes: 2, deleted: 1 });
    await introspector.waitForStatus("complete");
    expect((await env.SNAPSHOTS.list({ prefix: "card/" })).objects.map((object) => object.key)).toEqual([
      "card/ws-u-foreign/1.png",
    ]);
  });

  it("deletes at most the ceiling per run, oldest first, and the next run takes the rest", async () => {
    const total = FIXTURE_REAPER_CEILING + 5;
    const ids = Array.from({ length: total }, (_, index) => `u-bulk-${String(index).padStart(2, "0")}`);
    for (const [index, id] of ids.entries()) {
      await seed({
        id,
        email: `e2e+bulk${String(index)}@0509.io`,
        createdAt: `2026-10-01T10:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const first = await reapFixtureAccounts("live", NOW, direct);

    expect(first).toMatchObject({
      selected: FIXTURE_REAPER_CEILING,
      deleted: FIXTURE_REAPER_CEILING,
      ceilingHit: true,
    });
    const left = await env.DB.prepare('SELECT id FROM "user" ORDER BY id').all<{ id: string }>();
    expect(left.results.map((row) => row.id)).toEqual(ids.slice(FIXTURE_REAPER_CEILING));

    const second = await reapFixtureAccounts("live", NOW, direct);
    expect(second).toMatchObject({ selected: 5, deleted: 5, ceilingHit: false });
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);

    expect(await reapFixtureAccounts("live", NOW, direct)).toMatchObject({ selected: 0, deleted: 0 });
  });

  it("is idempotent: a second live run is a no-op, and a run that failed midway is finished by the next", async () => {
    await seed({ id: "u-twice", email: "e2e+twice@0509.io", watch: true, key: true });
    await seed({ id: "u-half", email: "e2e+half@0509.io", watch: true, key: true });

    const firstRun = await reapFixtureAccounts("live", NOW, direct);
    const secondRun = await reapFixtureAccounts("live", NOW, direct);

    expect(firstRun).toMatchObject({ selected: 2, deleted: 2 });
    expect(secondRun).toMatchObject({ selected: 0, deleted: 0, ceilingHit: false });

    await seed({ id: "u-late", email: "e2e+late@0509.io", watch: true, key: true });
    const failing: ReaperStep = (name, work) =>
      name.startsWith("remove") ? Promise.reject(new Error("D1 interrupted")) : work();
    await expect(reapFixtureAccounts("live", NOW, failing)).rejects.toThrow("D1 interrupted");
    expect(await userExists("u-late")).toBe(true);

    const resumed = await reapFixtureAccounts("live", NOW, direct);
    expect(resumed).toMatchObject({ selected: 1, deleted: 1 });
    expect(await userExists("u-late")).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM apikey")).toBe(0);
  });

  it("runs as a Workflow instance created on demand, dry-run by default, and the nightly start is once a day", async () => {
    await seed({ id: "u-flow", email: "e2e+flow@0509.io" });
    const id = "fixture-reaper-on-demand";
    await using introspector = await introspectWorkflowInstance(env.FIXTURE_REAPER_WORKFLOW, id);

    await env.FIXTURE_REAPER_WORKFLOW.create({ id });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toMatchObject({ mode: "dry-run", selected: 1, deleted: 0 });
    expect(await userExists("u-flow")).toBe(true);

    expect(await startFixtureReaper(NOW)).toBe("fixture-reaper-2026-10-21");
    expect(await startFixtureReaper(NOW)).toBe("fixture-reaper-2026-10-21");
  });
});
