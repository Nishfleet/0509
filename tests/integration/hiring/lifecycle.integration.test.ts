import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyHiringLifecycle,
  insertHiringSignals,
  type NewHiringSignal,
  readHiringSignalStates,
} from "../../../app/lib/data/signal.server";

const USER = "user-hiring-lifecycle";
const SOURCE_ID = "test-sig-lifecycle";
const TARGET_KEY = "https://boards.greenhouse.io/brand";
const NOW = "2026-09-24T12:00:00.000Z";

const hiringSignal = (overrides: Partial<NewHiringSignal> = {}): NewHiringSignal => ({
  id: "sig-r1",
  workspaceId: "ws-1",
  entityId: "ent-1",
  sourceId: SOURCE_ID,
  watchId: "W",
  snapshotId: null,
  roleId: "r1",
  platform: "greenhouse",
  title: "Engineer",
  location: null,
  team: null,
  url: "https://boards.greenhouse.io/brand/jobs/r1",
  publishedAt: null,
  observedAt: NOW,
  ...overrides,
});

const seed = async () => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, 'Owner', 'hiring-lifecycle@0509.io', 1, ?, ?)`,
  )
    .bind(USER, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, 'Lifecycle', ?, 'UTC', 1, 8, ?)`,
  )
    .bind("ws-1", USER, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES ('ent-1', 'ws-1', 'competitor', 'brand.com', '{}', 'manual', 'on', ?)`,
  )
    .bind(NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key)
     VALUES (?, 'test.sig.lifecycle', 'hiring', 'greenhouse', ?)`,
  )
    .bind(SOURCE_ID, SOURCE_ID)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('W', 'ent-1', ?, ?)",
    ).bind(SOURCE_ID, TARGET_KEY),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('other', 'ent-1', ?, ?)",
    ).bind(SOURCE_ID, `${TARGET_KEY}/other`),
  ]);
};

const signalRow = (id: string) =>
  env.DB.prepare(
    `SELECT last_seen_at, payload_json, is_tombstoned FROM signal WHERE id = ?1`,
  )
    .bind(id)
    .first<{ last_seen_at: string | null; payload_json: string; is_tombstoned: number }>();

const signalCount = async () => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM signal WHERE kind = 'hiring'`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
};

describe("hiring signal lifecycle", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.exec("DELETE FROM source WHERE id LIKE 'test-sig-%'");
    await seed();
  });

  it("readHiringSignalStates returns only the watch's hiring rows with roleId derived from dedup_key", async () => {
    await insertHiringSignals([
      hiringSignal({ id: "sig-W-r1", roleId: "r1" }),
      hiringSignal({ id: "sig-W-r2", roleId: "r2", url: "https://boards.greenhouse.io/brand/jobs/r2" }),
      hiringSignal({ id: "sig-W-r3", roleId: "r3", url: "https://boards.greenhouse.io/brand/jobs/r3" }),
      hiringSignal({
        id: "sig-other-r9",
        watchId: "other",
        roleId: "r9",
        url: "https://boards.greenhouse.io/brand/jobs/r9",
      }),
    ]);
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, watch_id, kind, payload_json, dedup_key, observed_at)
       VALUES ('sig-W-mismatch', 'ws-1', 'ent-1', ?1, 'W', 'hiring', '{}', 'someoneelse:r7', ?2)`,
    )
      .bind(SOURCE_ID, NOW)
      .run();

    const states = await readHiringSignalStates("W");
    expect(states).toHaveLength(3);
    expect(states.map((row) => row.roleId).sort()).toEqual(["r1", "r2", "r3"]);
    expect(states.every((row) => row.lastSeenAt === NOW)).toBe(true);
    expect(states.some((row) => row.roleId === "r7")).toBe(false);
  });

  it("applyHiringLifecycle updates only the listed ids, returns the change count, and never deletes", async () => {
    await insertHiringSignals([
      hiringSignal({ id: "sig-W-r1", roleId: "r1" }),
      hiringSignal({ id: "sig-W-r2", roleId: "r2", url: "https://boards.greenhouse.io/brand/jobs/r2" }),
      hiringSignal({ id: "sig-W-r3", roleId: "r3", url: "https://boards.greenhouse.io/brand/jobs/r3" }),
    ]);

    const TICK = "2026-09-24T13:00:00.000Z";
    const nextPayload = (rowId: string) =>
      JSON.stringify({ platform: "greenhouse", location: null, team: null, note: rowId });

    const changes = await applyHiringLifecycle([
      { id: "sig-W-r1", lastSeenAt: TICK, payloadJson: nextPayload("sig-W-r1") },
      { id: "sig-W-r2", lastSeenAt: TICK, payloadJson: nextPayload("sig-W-r2") },
    ]);

    expect(changes).toBe(2);

    const r1 = await signalRow("sig-W-r1");
    const r2 = await signalRow("sig-W-r2");
    const r3 = await signalRow("sig-W-r3");
    expect(r1).toMatchObject({ last_seen_at: TICK, is_tombstoned: 0 });
    expect(r2).toMatchObject({ last_seen_at: TICK, is_tombstoned: 0 });
    expect(r3).toMatchObject({ last_seen_at: NOW, is_tombstoned: 0 });
    expect(JSON.parse(r1?.payload_json ?? "null")).toMatchObject({ note: "sig-W-r1" });
    expect(JSON.parse(r2?.payload_json ?? "null")).toMatchObject({ note: "sig-W-r2" });
    expect(JSON.parse(r3?.payload_json ?? "null")).not.toMatchObject({ note: "sig-W-r3" });

    expect(await signalCount()).toBe(3);
  });

  it("applyHiringLifecycle returns 0 for an empty update list and makes no D1 call", async () => {
    await insertHiringSignals([hiringSignal({ id: "sig-W-r1", roleId: "r1" })]);
    const before = await signalRow("sig-W-r1");

    const changes = await applyHiringLifecycle([]);
    expect(changes).toBe(0);

    const after = await signalRow("sig-W-r1");
    expect(after?.last_seen_at).toBe(before?.last_seen_at);
    expect(after?.payload_json).toBe(before?.payload_json);
  });

  it("applyHiringLifecycle handles 120 updates across the 50-statement chunk boundary", async () => {
    await insertHiringSignals([
      hiringSignal({ id: "sig-W-r1", roleId: "r1" }),
      hiringSignal({ id: "sig-W-r2", roleId: "r2", url: "https://boards.greenhouse.io/brand/jobs/r2" }),
    ]);

    const inserts = Array.from({ length: 120 }, (_, index) => {
      const roleId = `r-bulk-${index + 1}`;
      return hiringSignal({
        id: `sig-W-${roleId}`,
        roleId,
        url: `https://boards.greenhouse.io/brand/jobs/${roleId}`,
      });
    });
    await insertHiringSignals(inserts);
    expect(await signalCount()).toBe(122);

    const TICK = "2026-09-24T13:30:00.000Z";
    const updates = inserts.map((row) => ({
      id: row.id,
      lastSeenAt: TICK,
      payloadJson: JSON.stringify({ platform: "greenhouse", location: null, team: null, roleId: row.roleId }),
    }));

    const changes = await applyHiringLifecycle(updates);
    expect(changes).toBe(120);
    expect(await signalCount()).toBe(122);

    const sample = await signalRow("sig-W-r-bulk-60");
    expect(sample?.last_seen_at).toBe(TICK);
    expect(JSON.parse(sample?.payload_json ?? "null")).toMatchObject({ roleId: "r-bulk-60" });

    const untouched = await signalRow("sig-W-r1");
    expect(untouched?.last_seen_at).toBe(NOW);
  });
});
