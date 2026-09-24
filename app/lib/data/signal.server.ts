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

export interface NewHiringSignal {
  id: string;
  workspaceId: string;
  entityId: string;
  sourceId: string;
  watchId: string;
  snapshotId: string | null;
  roleId: string;
  platform: string;
  title: string;
  location: string | null;
  team: string | null;
  url: string;
  publishedAt: string | null;
  observedAt: string;
}

const INSERT_HIRING = `INSERT INTO signal
  (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
   url, evidence_url, payload_json, dedup_key, published_at, observed_at, last_seen_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'hiring', ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13, ?13)
ON CONFLICT (source_id, dedup_key) DO NOTHING`;

const HIRING_BATCH = 50;

export async function insertHiringSignals(rows: readonly NewHiringSignal[]): Promise<void> {
  if (rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += HIRING_BATCH) {
    const chunk = rows.slice(offset, offset + HIRING_BATCH);
    await env.DB.batch(
      chunk.map((row) => {
        const summaryParts = [row.location, row.team].filter(
          (part) => part !== null && part !== "",
        );
        const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : null;
        const dedupKey = `${row.watchId}:${row.roleId}`;
        return env.DB.prepare(INSERT_HIRING).bind(
          row.id,
          row.workspaceId,
          row.entityId,
          row.sourceId,
          row.watchId,
          row.snapshotId,
          row.title,
          summary,
          row.url,
          JSON.stringify({ platform: row.platform, location: row.location, team: row.team }),
          dedupKey,
          row.publishedAt,
          row.observedAt,
        );
      }),
    );
  }
}

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

const DELETE_ENTITY_SIGNALS = `DELETE FROM signal WHERE workspace_id = ?1 AND entity_id = ?2`;

export function deleteEntitySignals(workspaceId: string, entityId: string): D1PreparedStatement {
  return env.DB.prepare(DELETE_ENTITY_SIGNALS).bind(workspaceId, entityId);
}

export interface SignalCount {
  kind: string;
  count: number;
}

const COUNT_SIGNALS_BY_KIND = `SELECT kind, COUNT(*) AS n FROM signal WHERE workspace_id = ?1 AND entity_id = ?2 AND observed_at >= ?3 AND is_tombstoned = 0 GROUP BY kind ORDER BY kind`;

export async function readSignalCounts(
  workspaceId: string,
  entityId: string,
  since: string,
): Promise<readonly SignalCount[]> {
  const { results } = await env.DB.prepare(COUNT_SIGNALS_BY_KIND)
    .bind(workspaceId, entityId, since)
    .all<{ kind: string; n: number }>();
  return results.map((row) => ({ kind: row.kind, count: row.n }));
}
