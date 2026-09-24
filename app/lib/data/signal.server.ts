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

export interface RecentSignal {
  kind: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  aspect: string | null;
  observedAt: string;
}

const SELECT_RECENT_SIGNALS =
  "SELECT kind, title, summary, url, aspect, observed_at FROM signal WHERE entity_id = ? AND observed_at >= ? AND is_tombstoned = 0 ORDER BY observed_at DESC LIMIT 50";

interface RecentSignalRow {
  kind: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  aspect: string | null;
  observed_at: string;
}

export async function readRecentSignals(entityId: string, since: string): Promise<RecentSignal[]> {
  const { results } = await env.DB.prepare(SELECT_RECENT_SIGNALS).bind(entityId, since).all<RecentSignalRow>();
  return results.map((row) => ({
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    aspect: row.aspect,
    observedAt: row.observed_at,
  }));
}

export interface SiteChangeRow {
  id: string;
  entity_id: string;
  entity_name: string | null;
  entity_domain: string;
  entity_role: "self" | "competitor";
  url: string;
  payload_json: string;
  observed_at: string;
  before_at: string | null;
  after_at: string | null;
}

const SELECT_SITE_CHANGES = `SELECT s.id, s.entity_id, e.name AS entity_name, e.domain AS entity_domain,
  e.role AS entity_role, s.url, s.payload_json, s.observed_at,
  b.fetched_at AS before_at, a.fetched_at AS after_at
FROM signal s
JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id
LEFT JOIN snapshot a ON a.id = s.snapshot_id
LEFT JOIN snapshot b ON b.id = json_extract(s.payload_json, '$.before.snapshotId')
WHERE s.workspace_id = ?1
  AND s.kind = 'change'
  AND s.is_tombstoned = 0
  AND s.observed_at >= ?2
  AND (?3 IS NULL OR s.entity_id = ?3)
  AND (?3 IS NOT NULL OR e.state = 'on')
ORDER BY s.observed_at DESC, s.id DESC
LIMIT ?4`;

export async function readSiteChanges(input: {
  workspaceId: string;
  entityId: string | null;
  since: string;
  limit: number;
}): Promise<SiteChangeRow[]> {
  const { results } = await env.DB.prepare(SELECT_SITE_CHANGES)
    .bind(input.workspaceId, input.since, input.entityId, input.limit)
    .all<SiteChangeRow>();
  return results;
}

const SELECT_SITE_CHANGE_PAYLOAD = `SELECT payload_json FROM signal
WHERE id = ? AND workspace_id = ? AND kind = 'change' AND is_tombstoned = 0`;

export async function readSiteChangePayload(workspaceId: string, signalId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_SITE_CHANGE_PAYLOAD)
    .bind(signalId, workspaceId)
    .first<{ payload_json: string }>();
  return row?.payload_json ?? null;
}
