import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertWatches, readHiringTargets } from "../../../app/lib/data/watch.server";
import { readBoard } from "../../../app/lib/hiring/read-board.server";

const USER = "user-hiring-read-board";
const WS = "ws-hiring-read-board";
const NOW = "2026-09-24T02:00:00Z";
const WATCH_ID = "watch-rival-hiring";
const BOARD_URL = "https://job-boards.greenhouse.io/rival";
const LISTING_URL = "https://boards-api.greenhouse.io/v1/boards/rival/jobs";

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const job = (id: number, title: string) => ({
  id,
  title,
  absolute_url: `https://job-boards.greenhouse.io/rival/jobs/${id}`,
  location: { name: "Remote" },
  first_published: "2026-09-20T00:00:00.000Z",
});

const NIGHT_ONE = { jobs: [job(101, "Platform Engineer"), job(102, "Product Designer")] };
const NIGHT_THREE = {
  jobs: [...NIGHT_ONE.jobs, job(103, "Data Scientist")],
};

const listing = { status: 200, body: JSON.stringify(NIGHT_ONE) };

const target = async () => {
  const [row] = (await readHiringTargets()).filter((t) => t.watchId === WATCH_ID);
  if (row === undefined) throw new Error("expected the rival hiring target");
  return row;
};

const snapshotRows = async () => {
  const { results } = await env.DB.prepare(
    "SELECT id, payload_r2_key, payload_hash, item_count FROM snapshot WHERE watch_id = ?1 ORDER BY fetched_at",
  )
    .bind(WATCH_ID)
    .all<{ id: string; payload_r2_key: string | null; payload_hash: string; item_count: number }>();
  return results;
};

const signalRows = async () => {
  const { results } = await env.DB.prepare(
    "SELECT kind, title, dedup_key, snapshot_id FROM signal WHERE workspace_id = ?1 ORDER BY observed_at",
  )
    .bind(WS)
    .all<{ kind: string; title: string | null; dedup_key: string; snapshot_id: string | null }>();
  return results;
};

describe("readBoard", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const stored = await env.SNAPSHOTS.list({ prefix: "snapshot/hiring/" });
    await Promise.all(stored.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'hiring-read-board@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Hiring', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
       VALUES ('ent-rival', ?, 'competitor', 'rival.com', '{}', 'manual', 'on', ?)`,
    )
      .bind(WS, NOW)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES ('src_hiring_greenhouse', 'hiring.greenhouse', 'hiring', 'greenhouse', 'hiring.board', 'official_api', 1, '{}')`,
    ).run();
    await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = 'src_hiring_greenhouse'").run();
    await insertWatches([
      { id: WATCH_ID, entityId: "ent-rival", sourceId: "src_hiring_greenhouse", targetKey: BOARD_URL },
    ]);

    listing.status = 200;
    listing.body = JSON.stringify(NIGHT_ONE);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== LISTING_URL) {
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }
      return Promise.resolve(new Response(listing.body, { status: listing.status }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("files the first snapshot as the baseline and no signals", async () => {
    const result = await readBoard(await target(), await nextTick("night-1"));

    expect(result).toMatchObject({ outcome: "first", newRoles: 0 });
    expect(await signalRows()).toEqual([]);
    const snapshots = await snapshotRows();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id: `night-1-${WATCH_ID}`, item_count: 2 });
    const stored = await env.SNAPSHOTS.get(snapshots[0]?.payload_r2_key ?? "");
    expect(JSON.parse((await stored?.text()) ?? "[]")).toHaveLength(2);
  });

  it("returns unchanged on the same roles and reuses the first snapshot's R2 key", async () => {
    const t = await target();
    await readBoard(t, await nextTick("night-1"));
    const result = await readBoard(t, await nextTick("night-2"));

    expect(result).toMatchObject({ outcome: "unchanged", newRoles: 0 });
    const snapshots = await snapshotRows();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.payload_r2_key).toBe(snapshots[0]?.payload_r2_key);
    expect(await signalRows()).toEqual([]);
  });

  it("files one hiring signal per role that was not in the previous snapshot", async () => {
    const t = await target();
    await readBoard(t, await nextTick("night-1"));
    await readBoard(t, await nextTick("night-2"));
    listing.body = JSON.stringify(NIGHT_THREE);
    const night3 = await nextTick("night-3");
    const result = await readBoard(t, night3);

    expect(result).toMatchObject({ outcome: "changed", newRoles: 1 });
    const signals = await signalRows();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: "hiring",
      title: "Data Scientist",
      dedup_key: `${WATCH_ID}:103`,
      snapshot_id: `night-3-${WATCH_ID}`,
    });

    const again = await readBoard(t, night3);
    expect(again).toMatchObject({ outcome: "changed", newRoles: 0 });
    expect(await signalRows()).toHaveLength(1);
    expect(await snapshotRows()).toHaveLength(3);
  });

  it("deactivates the watch when the listing answers 404", async () => {
    listing.status = 404;
    const result = await readBoard(await target(), await nextTick("night-1"));

    expect(result).toMatchObject({ outcome: "gone", newRoles: 0 });
    const watch = await env.DB.prepare("SELECT is_active FROM watch WHERE id = ?1")
      .bind(WATCH_ID)
      .first<{ is_active: number }>();
    expect(watch?.is_active).toBe(0);
    expect(await snapshotRows()).toEqual([]);
  });

  it("rejects on a 500 and writes no snapshot for that tick", async () => {
    const t = await target();
    await readBoard(t, await nextTick("night-1"));
    listing.status = 500;

    await expect(readBoard(t, await nextTick("night-2"))).rejects.toThrow("hiring.listing_status 500");
    expect(await snapshotRows()).toHaveLength(1);
    expect(await signalRows()).toEqual([]);
  });
});
