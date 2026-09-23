import { env } from "cloudflare:workers";

const LATEST_SITE_SNAPSHOT = `SELECT id, payload_hash, payload_r2_key FROM snapshot
WHERE watch_id = ? AND page_id = ?
ORDER BY fetched_at DESC LIMIT 1`;

const INSERT_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
VALUES (?, ?, ?, ?, ?, ?, 1)`;

interface SiteSnapshotRow {
  id: string;
  payload_hash: string;
  payload_r2_key: string | null;
}

export async function latestSiteSnapshot(
  watchId: string,
  pageId: string,
): Promise<SiteSnapshotRow | null> {
  return env.DB.prepare(LATEST_SITE_SNAPSHOT)
    .bind(watchId, pageId)
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
