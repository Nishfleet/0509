import { env } from "cloudflare:workers";

export interface SiteChangeSignal {
  id: string;
  workspaceId: string;
  entityId: string;
  sourceId: string;
  watchId: string;
  snapshotId: string;
  aspect: string;
  url: string;
  payloadJson: string;
  observedAt: string;
}

const INSERT_SITE_CHANGE = `INSERT INTO signal
  (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, aspect,
   url, evidence_url, payload_json, dedup_key, observed_at, last_seen_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'change', ?7, ?8, ?8, ?9, ?6, ?10, ?10)
ON CONFLICT (source_id, dedup_key) DO NOTHING`;

export async function insertSiteChange(row: SiteChangeSignal): Promise<void> {
  await env.DB.prepare(INSERT_SITE_CHANGE)
    .bind(
      row.id,
      row.workspaceId,
      row.entityId,
      row.sourceId,
      row.watchId,
      row.snapshotId,
      row.aspect,
      row.url,
      row.payloadJson,
      row.observedAt,
    )
    .run();
}

const INSERT_MENTION = `INSERT INTO signal
  (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, url, canonical_url, url_hash,
   author, payload_json, dedup_key, published_at, observed_at, last_seen_at, is_tombstoned)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'mention', ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15)
ON CONFLICT (source_id, dedup_key) DO NOTHING`;

const SEEN_KEYS = "SELECT dedup_key FROM signal WHERE source_id = ?1 AND dedup_key IN (SELECT value FROM json_each(?2))";

export interface MentionSignal {
  id: string;
  workspaceId: string;
  entityId: string;
  sourceId: string;
  watchId: string;
  snapshotId: string;
  title: string;
  url: string;
  urlHash: string;
  publisher: string | null;
  dedupKey: string;
  publishedAt: string | null;
  observedAt: string;
  isNotAboutBrand: boolean;
}

export async function readSeenDedupKeys(sourceId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await env.DB.prepare(SEEN_KEYS).bind(sourceId, JSON.stringify(keys)).all<{ dedup_key: string }>();
  return new Set(rows.results.map((row) => row.dedup_key));
}

export function insertMention(signal: MentionSignal): D1PreparedStatement {
  return env.DB.prepare(INSERT_MENTION).bind(
    signal.id,
    signal.workspaceId,
    signal.entityId,
    signal.sourceId,
    signal.watchId,
    signal.snapshotId,
    signal.title,
    signal.url,
    signal.urlHash,
    signal.publisher,
    JSON.stringify({ publisher: signal.publisher }),
    signal.dedupKey,
    signal.publishedAt,
    signal.observedAt,
    signal.isNotAboutBrand ? 1 : 0,
  );
}
