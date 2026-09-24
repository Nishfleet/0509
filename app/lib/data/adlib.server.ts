import { env } from "cloudflare:workers";
import { z } from "zod";

export const ADLIB_SOURCE_ID = "src_discovery_meta_adlib";

const SELECT_SELF = `SELECT id, name, domain,
  json_extract(identity_json, '$.category') AS category,
  json_extract(identity_json, '$.description') AS description,
  COALESCE(json_extract(identity_json, '$.market'), json_extract(identity_json, '$.country')) AS market
FROM entity WHERE workspace_id = ? AND role = 'self'`;

const INSERT_WATCH = `INSERT INTO watch (id, entity_id, source_id, target_key, is_active)
VALUES (?1, ?2, ?3, ?4, 1)
ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`;

const SELECT_WATCH = `SELECT id FROM watch WHERE entity_id = ? AND source_id = ? AND target_key = ?`;

const INSERT_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)
ON CONFLICT (id) DO NOTHING`;

const SELECT_SNAPSHOT = `SELECT id, fetched_at, payload_r2_key, item_count FROM snapshot WHERE id = ?`;

const LATEST_KEY = `SELECT sn.payload_r2_key AS payload_r2_key
FROM snapshot sn
JOIN watch w ON w.id = sn.watch_id
JOIN entity e ON e.id = w.entity_id
WHERE e.workspace_id = ?1 AND e.role = 'self' AND w.source_id = ?2
ORDER BY sn.fetched_at DESC
LIMIT 1`;

const SELF_ROW = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  market: z.string().nullable(),
});

const SNAPSHOT_ROW = z.object({
  id: z.string(),
  fetched_at: z.string(),
  payload_r2_key: z.string().nullable(),
  item_count: z.number(),
});

export interface AdlibSelf {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  market: string | null;
}

export interface AdlibSnapshotRow {
  id: string;
  fetchedAt: string;
  payloadR2Key: string | null;
  itemCount: number;
}

function label(name: string | null, domain: string): string {
  if (name !== null && name.trim() !== "") return name.trim();
  return domain;
}

export async function readAdlibSelf(workspaceId: string): Promise<AdlibSelf | null> {
  const row = await env.DB.prepare(SELECT_SELF).bind(workspaceId).first();
  if (row === null) return null;
  const parsed = SELF_ROW.safeParse(row);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "discovery.meta_adlib_self_unreadable", workspaceId }));
    return null;
  }
  return {
    id: parsed.data.id,
    name: label(parsed.data.name, parsed.data.domain),
    category: parsed.data.category,
    description: parsed.data.description,
    market: parsed.data.market,
  };
}

export async function ensureAdlibWatch(entityId: string, targetKey: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(INSERT_WATCH).bind(id, entityId, ADLIB_SOURCE_ID, targetKey).run();
  const row = await env.DB.prepare(SELECT_WATCH).bind(entityId, ADLIB_SOURCE_ID, targetKey).first<{ id: string }>();
  if (row === null) throw new Error("adlib watch missing after insert");
  return row.id;
}

export async function readAdlibSnapshot(id: string): Promise<AdlibSnapshotRow | null> {
  const row = await env.DB.prepare(SELECT_SNAPSHOT).bind(id).first();
  if (row === null) return null;
  const parsed = SNAPSHOT_ROW.safeParse(row);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "discovery.meta_adlib_snapshot_unreadable", id }));
    return null;
  }
  return {
    id: parsed.data.id,
    fetchedAt: parsed.data.fetched_at,
    payloadR2Key: parsed.data.payload_r2_key,
    itemCount: parsed.data.item_count,
  };
}

export async function insertAdlibSnapshot(row: {
  id: string;
  watchId: string;
  fetchedAt: string;
  r2Key: string;
  hash: string;
  itemCount: number;
}): Promise<void> {
  await env.DB.prepare(INSERT_SNAPSHOT)
    .bind(row.id, row.watchId, row.fetchedAt, row.r2Key, row.hash, row.itemCount)
    .run();
}

export async function latestAdlibPayloadKey(workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare(LATEST_KEY).bind(workspaceId, ADLIB_SOURCE_ID).first<{ payload_r2_key: string | null }>();
  return row?.payload_r2_key ?? null;
}
