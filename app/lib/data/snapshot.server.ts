/**
 * `snapshot` — the cost boundary: one row per page per tick, body in R2
 * (docs/REBUILD-SCHEMA.md §6). payload_hash is the hash gate; a page whose
 * hash matches the previous snapshot costs a fetch, never a screenshot.
 */
import type { DataEnv } from "./entity.server";

export interface SnapshotEnv extends DataEnv {
  SNAPSHOTS: R2Bucket;
}

export interface SnapshotRow {
  id: string;
  watch_id: string;
  page_id: string | null;
  fetched_at: string;
  payload_r2_key: string | null;
  payload_hash: string;
  item_count: number;
}

export interface SnapshotPayload {
  url: string;
  fetched_at: string;
  text: string;
  fields: Record<string, unknown>;
  html: string;
  screenshot_key: string | null;
}

export function snapshotPayloadKey(
  entityId: string,
  pageId: string,
  snapshotId: string,
): string {
  return `site/${entityId}/${pageId}/${snapshotId}.json`;
}

export async function writeSnapshotPayload(
  env: SnapshotEnv,
  key: string,
  payload: SnapshotPayload,
): Promise<void> {
  await env.SNAPSHOTS.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function readSnapshotPayload(
  env: SnapshotEnv,
  key: string,
): Promise<SnapshotPayload | null> {
  const obj = await env.SNAPSHOTS.get(key);
  if (!obj) return null;
  return obj.json<SnapshotPayload>();
}

export async function insertSnapshot(
  env: DataEnv,
  row: {
    id: string;
    watch_id: string;
    page_id: string;
    payload_r2_key: string;
    payload_hash: string;
    item_count: number;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      row.id,
      row.watch_id,
      row.page_id,
      new Date().toISOString(),
      row.payload_r2_key,
      row.payload_hash,
      row.item_count,
    )
    .run();
}

export async function latestSnapshotForPage(
  env: DataEnv,
  pageId: string,
): Promise<SnapshotRow | null> {
  return env.DB.prepare(
    "SELECT id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count FROM snapshot WHERE page_id = ? ORDER BY fetched_at DESC LIMIT 1",
  )
    .bind(pageId)
    .first<SnapshotRow>();
}
