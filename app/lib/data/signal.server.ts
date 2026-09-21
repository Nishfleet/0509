/**
 * `signal` — the curated spine. A change becomes a row here only after a Jev
 * verdict: p >= 0.9 publishes, the 0.1 < p < 0.9 band publishes low marked
 * "possibly" (payload_json.verdict = 'uncertain'), p <= 0.1 never lands.
 * dedup_key carries UNIQUE(source_id, dedup_key) so a re-polled identical
 * change collapses instead of duplicating.
 */
import type { DataEnv } from "./entity.server";

export interface SignalInsert {
  workspace_id: string;
  entity_id: string;
  source_id: string;
  watch_id: string;
  snapshot_id: string;
  kind: string;
  aspect: string;
  title: string;
  summary: string;
  url: string;
  dedup_key: string;
  payload: Record<string, unknown>;
}

export async function insertSignal(
  env: DataEnv,
  row: SignalInsert,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO signal
       (id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind,
        title, summary, url, aspect, payload_json, dedup_key, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      row.workspace_id,
      row.entity_id,
      row.source_id,
      row.watch_id,
      row.snapshot_id,
      row.kind,
      row.title,
      row.summary,
      row.url,
      row.aspect,
      JSON.stringify(row.payload),
      row.dedup_key,
      now,
    )
    .run();
  return id;
}

export interface SignalHistoryRow {
  kind: string;
  title: string | null;
  summary: string | null;
  observed_at: string;
}

export async function listRecentSignalsForEntity(
  env: DataEnv,
  entityId: string,
): Promise<SignalHistoryRow[]> {
  const rows = await env.DB.prepare(
    `SELECT kind, title, summary, observed_at FROM signal
     WHERE entity_id = ? AND is_tombstoned = 0
       AND observed_at > datetime('now', '-30 days')
     ORDER BY observed_at DESC LIMIT 30`,
  )
    .bind(entityId)
    .all<SignalHistoryRow>();
  return rows.results ?? [];
}
