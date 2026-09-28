import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  insertSnapshot,
  insertBoardSnapshot,
  insertWatchSnapshot,
} from "../../app/lib/data/snapshot.server";
import { readRegistrySources } from "../../app/lib/data/source.server";

const MIGRATION = "0026_source_latest_snapshot.sql";

const OWNER = "user-src-latest";
const WS = "ws-src-latest";
const ENTITY = "ent-src-latest";
const SOURCE = "src-latest-mentions";
const SOURCE_BACKFILL = "src-latest-backfill";
const WATCH = "watch-src-latest";
const WATCH_TIE = "watch-src-latest-tie";
const WATCH_BACKFILL = "watch-src-latest-backfill";
const WATCH_BACKFILL_OTHER = "watch-src-latest-backfill-other";
const PAGE = "page-src-latest";
const SEEDED_AT = "2026-09-24T00:00:00Z";

interface LatestFacts {
  latest_fetched_at: string | null;
  latest_item_count: number | null;
  latest_canary_count: number | null;
}

const latestFacts = async (sourceId: string): Promise<LatestFacts> => {
  const row = await env.DB.prepare(
    "SELECT latest_fetched_at, latest_item_count, latest_canary_count FROM source WHERE id = ?1",
  )
    .bind(sourceId)
    .first<LatestFacts>();
  if (row === null) throw new Error("seeded source row missing");
  return row;
};

const seedWatch = async (watchId: string, sourceId: string, targetKey = "acme"): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
  )
    .bind(watchId, ENTITY, sourceId, targetKey)
    .run();
};

const seedSource = async (sourceId: string, watchId: string): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO source (id, key, kind, platform, plugin_key) VALUES (?1, ?2, 'mentions', 'gdelt', ?3)",
  )
    .bind(sourceId, `test.${sourceId}`, sourceId)
    .run();
  await seedWatch(watchId, sourceId);
};

const seedBase = async (): Promise<void> => {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
  )
    .bind(OWNER, "src-latest@0509.io", SEEDED_AT)
    .run();
  await env.DB.prepare(
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Latest snapshot', ?2, 'UTC', 1, 8, ?3)",
  )
    .bind(WS, OWNER, SEEDED_AT)
    .run();
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'competitor', 'acme.example', 'Acme', ?3)",
  )
    .bind(ENTITY, WS, SEEDED_AT)
    .run();
  await env.DB.prepare(
    "INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?1, ?2, 'https://acme.example/', ?3)",
  )
    .bind(PAGE, ENTITY, SEEDED_AT)
    .run();
};

const snapshotStatement = (
  id: string,
  watchId: string,
  fetchedAt: string,
  itemCount: number,
  canaryCount: number | null,
): D1PreparedStatement =>
  env.DB.prepare(
    "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count, canary_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  ).bind(id, watchId, fetchedAt, `hash-${id}`, itemCount, canaryCount);

describe("source latest snapshot facts (0509#5724)", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM snapshot"),
      env.DB.prepare("DELETE FROM watch"),
      env.DB.prepare("DELETE FROM page"),
      env.DB.prepare("DELETE FROM entity"),
      env.DB.prepare("DELETE FROM source WHERE id LIKE 'src-latest-%'"),
      env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(OWNER),
    ]);
    await seedBase();
  });

  it("mentions path: batching insertWatchSnapshot writes the source latest facts", async () => {
    await seedSource(SOURCE, WATCH);
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-m-1",
        watchId: WATCH,
        fetchedAt: "2026-09-25T01:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-m-1.json",
        hash: "hash-m-1",
        itemCount: 5,
        canaryCount: 3,
      }),
    );

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T01:00:00Z",
      latest_item_count: 5,
      latest_canary_count: 3,
    });
  });

  it("older snapshot does not overwrite", async () => {
    await seedSource(SOURCE, WATCH);
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-m-1",
        watchId: WATCH,
        fetchedAt: "2026-09-25T01:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-m-1.json",
        hash: "hash-m-1",
        itemCount: 5,
        canaryCount: 3,
      }),
    );
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-m-0",
        watchId: WATCH,
        fetchedAt: "2026-09-25T00:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-m-0.json",
        hash: "hash-m-0",
        itemCount: 99,
        canaryCount: 9,
      }),
    );

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T01:00:00Z",
      latest_item_count: 5,
      latest_canary_count: 3,
    });
  });

  it("newer snapshot overwrites", async () => {
    await seedSource(SOURCE, WATCH);
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-m-1",
        watchId: WATCH,
        fetchedAt: "2026-09-25T01:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-m-1.json",
        hash: "hash-m-1",
        itemCount: 5,
        canaryCount: 3,
      }),
    );
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-m-2",
        watchId: WATCH,
        fetchedAt: "2026-09-25T02:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-m-2.json",
        hash: "hash-m-2",
        itemCount: 7,
        canaryCount: null,
      }),
    );

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T02:00:00Z",
      latest_item_count: 7,
      latest_canary_count: null,
    });
  });

  it("site path: insertSnapshot writes item count 1 and a null canary count", async () => {
    await seedSource(SOURCE, WATCH);
    await insertSnapshot({
      id: "snap-site-1",
      watchId: WATCH,
      pageId: PAGE,
      fetchedAt: "2026-09-25T03:00:00Z",
      r2Key: "snapshot/site/watch-src-latest/snap-site-1.txt",
      hash: "hash-site-1",
    });

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T03:00:00Z",
      latest_item_count: 1,
      latest_canary_count: null,
    });
  });

  it("hiring path: insertBoardSnapshot writes the board item count and a null canary count", async () => {
    await seedSource(SOURCE, WATCH);
    await insertBoardSnapshot({
      id: "snap-board-1",
      watchId: WATCH,
      fetchedAt: "2026-09-25T04:00:00Z",
      r2Key: "snapshot/hiring/watch-src-latest/snap-board-1.json",
      hash: "hash-board-1",
      itemCount: 7,
    });

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T04:00:00Z",
      latest_item_count: 7,
      latest_canary_count: null,
    });
  });

  it("a deduplicated snapshot id does not move the facts", async () => {
    await seedSource(SOURCE, WATCH);
    await insertSnapshot({
      id: "snap-site-retry",
      watchId: WATCH,
      pageId: PAGE,
      fetchedAt: "2026-09-25T05:00:00Z",
      r2Key: "snapshot/site/watch-src-latest/snap-site-retry.txt",
      hash: "hash-site-retry",
    });
    await insertSnapshot({
      id: "snap-site-retry",
      watchId: WATCH,
      pageId: PAGE,
      fetchedAt: "2026-09-25T05:10:00Z",
      r2Key: "snapshot/site/watch-src-latest/snap-site-retry.txt",
      hash: "hash-site-retry",
    });

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T05:00:00Z",
      latest_item_count: 1,
      latest_canary_count: null,
    });
  });

  it("an equal fetched_at is not newer: the first committed fact set stays", async () => {
    await seedSource(SOURCE, WATCH);
    await seedWatch(WATCH_TIE, SOURCE, "acme-campaign");
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-tie-a",
        watchId: WATCH,
        fetchedAt: "2026-09-25T06:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-tie-a.json",
        hash: "hash-tie-a",
        itemCount: 4,
        canaryCount: 1,
      }),
    );
    await env.DB.batch(
      insertWatchSnapshot({
        id: "snap-tie-b",
        watchId: WATCH_TIE,
        fetchedAt: "2026-09-25T06:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-tie-b.json",
        hash: "hash-tie-b",
        itemCount: 9,
        canaryCount: 7,
      }),
    );

    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T06:00:00Z",
      latest_item_count: 4,
      latest_canary_count: 1,
    });
  });

  it("adds three nullable columns to source, proven with PRAGMA on real D1", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(source)").all<{
      name: string;
      type: string;
      notnull: number;
    }>();
    const columns = new Map(results.map((column) => [column.name, column]));

    for (const [name, type] of [
      ["latest_fetched_at", "TEXT"],
      ["latest_item_count", "INTEGER"],
      ["latest_canary_count", "INTEGER"],
    ] as const) {
      const column = columns.get(name);
      if (!column) throw new Error(`source is missing the ${name} column`);
      expect(column.type, `${name} must be ${type}`).toBe(type);
      expect(column.notnull, `${name} must be nullable so a code rollback stays safe`).toBe(0);
    }
  });

  it("the stored facts equal what the registry read recomputes, across watches", async () => {
    await seedSource(SOURCE, WATCH);
    await seedWatch(WATCH_TIE, SOURCE, "acme-second");
    await env.DB.batch([
      ...insertWatchSnapshot({
        id: "snap-p-1",
        watchId: WATCH,
        fetchedAt: "2026-09-25T07:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-p-1.json",
        hash: "hash-p-1",
        itemCount: 11,
        canaryCount: 1,
      }),
      ...insertWatchSnapshot({
        id: "snap-p-2",
        watchId: WATCH_TIE,
        fetchedAt: "2026-09-25T08:00:00Z",
        r2Key: "snapshot/mentions/gdelt/snap-p-2.json",
        hash: "hash-p-2",
        itemCount: 12,
        canaryCount: 2,
      }),
    ]);

    const registry = await readRegistrySources();
    const entry = registry.find((one) => one.source.key === `test.${SOURCE}`);
    if (entry === undefined) throw new Error("seeded source missing from the registry read");
    expect(entry.snapshot).toEqual({
      fetched_at: "2026-09-25T08:00:00Z",
      item_count: 12,
      canary_count: 2,
    });
    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: "2026-09-25T08:00:00Z",
      latest_item_count: 12,
      latest_canary_count: 2,
    });
  });

  it("the migration's backfill statement seeds the facts from stored snapshots", async () => {
    await seedSource(SOURCE, WATCH);
    await seedSource(SOURCE_BACKFILL, WATCH_BACKFILL);
    await seedWatch(WATCH_BACKFILL_OTHER, SOURCE_BACKFILL, "backfill-other");
    await env.DB.batch([
      snapshotStatement("snap-bf-1", WATCH_BACKFILL, "2026-09-25T01:00:00Z", 4, 2),
      snapshotStatement("snap-bf-2", WATCH_BACKFILL_OTHER, "2026-09-25T02:00:00Z", 6, 8),
      snapshotStatement("snap-bf-3", WATCH_BACKFILL, "2026-09-25T03:00:00Z", 10, 5),
    ]);

    const migration: D1Migration[] = env.TEST_MIGRATIONS;
    const backfill = migration
      .filter((one) => one.name === MIGRATION)
      .flatMap((one) => one.queries)
      .filter((query) => query.startsWith("UPDATE source"));
    expect(backfill).toHaveLength(1);
    const statement = backfill.at(0);
    if (statement === undefined) throw new Error("0026 backfill statement missing");
    await env.DB.prepare(statement).run();

    expect(await latestFacts(SOURCE_BACKFILL)).toEqual({
      latest_fetched_at: "2026-09-25T03:00:00Z",
      latest_item_count: 10,
      latest_canary_count: 5,
    });
    expect(await latestFacts(SOURCE)).toEqual({
      latest_fetched_at: null,
      latest_item_count: null,
      latest_canary_count: null,
    });
  });
});
