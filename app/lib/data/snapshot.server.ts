import { env } from "cloudflare:workers";
import { z } from "zod";

const LATEST_SITE_SNAPSHOT = `SELECT id, payload_hash, payload_r2_key FROM snapshot
WHERE watch_id = ? AND page_id = ? AND fetched_at < ?
ORDER BY fetched_at DESC LIMIT 1`;

const INSERT_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
VALUES (?, ?, ?, ?, ?, ?, 1)
ON CONFLICT (id) DO NOTHING`;

interface SiteSnapshotRow {
  id: string;
  payload_hash: string;
  payload_r2_key: string | null;
}

export async function latestSiteSnapshot(
  watchId: string,
  pageId: string,
  before: string,
): Promise<SiteSnapshotRow | null> {
  return env.DB.prepare(LATEST_SITE_SNAPSHOT)
    .bind(watchId, pageId, before)
    .first<SiteSnapshotRow>();
}

export async function insertSnapshot(row: {
  id: string;
  watchId: string;
  pageId: string;
  fetchedAt: string;
  r2Key: string | null;
  hash: string;
}): Promise<void> {
  await env.DB.prepare(INSERT_SNAPSHOT)
    .bind(row.id, row.watchId, row.pageId, row.fetchedAt, row.r2Key, row.hash)
    .run();
}

const INSERT_WATCH_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count, canary_count)
VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`;

export function insertWatchSnapshot(row: {
  id: string;
  watchId: string;
  fetchedAt: string;
  r2Key: string;
  hash: string;
  itemCount: number;
  canaryCount: number | null;
}): D1PreparedStatement {
  return env.DB.prepare(INSERT_WATCH_SNAPSHOT).bind(
    row.id,
    row.watchId,
    row.fetchedAt,
    row.r2Key,
    row.hash,
    row.itemCount,
    row.canaryCount,
  );
}

const LATEST_BOARD_SNAPSHOT = `SELECT id, payload_hash, payload_r2_key, item_count FROM snapshot
WHERE watch_id = ?1 AND page_id IS NULL AND fetched_at < ?2
ORDER BY fetched_at DESC LIMIT 1`;

const INSERT_BOARD_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)
ON CONFLICT (id) DO NOTHING`;

const boardSnapshotRow = z.object({
  id: z.string(),
  payload_hash: z.string(),
  payload_r2_key: z.string().nullable(),
  item_count: z.number(),
});

export interface BoardSnapshot {
  id: string;
  hash: string;
  r2Key: string | null;
  itemCount: number;
}

export async function latestBoardSnapshot(
  watchId: string,
  before: string,
): Promise<BoardSnapshot | null> {
  const row = await env.DB.prepare(LATEST_BOARD_SNAPSHOT).bind(watchId, before).first();
  if (row === null) return null;
  const parsed = boardSnapshotRow.parse(row);
  return {
    id: parsed.id,
    hash: parsed.payload_hash,
    r2Key: parsed.payload_r2_key,
    itemCount: parsed.item_count,
  };
}

export async function insertBoardSnapshot(row: {
  id: string;
  watchId: string;
  fetchedAt: string;
  r2Key: string | null;
  hash: string;
  itemCount: number;
}): Promise<void> {
  await env.DB.prepare(INSERT_BOARD_SNAPSHOT)
    .bind(row.id, row.watchId, row.fetchedAt, row.r2Key, row.hash, row.itemCount)
    .run();
}
