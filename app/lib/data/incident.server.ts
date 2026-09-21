/**
 * `incident` + `incident_notice` — an own-site breakage is an incident with a
 * lifecycle, not an unread flag. One open incident per page is enforced by
 * idx_incident_one_open_per_page; one notice email per page per day by
 * UNIQUE(page_id, sent_on). Both invariants are insert failures, not counts.
 */
import type { DataEnv } from "./entity.server";

export interface IncidentRow {
  id: string;
  workspace_id: string;
  entity_id: string;
  page_id: string;
  kind: string;
  opened_at: string;
  closed_at: string | null;
}

export async function openIncident(
  env: DataEnv,
  row: {
    workspace_id: string;
    entity_id: string;
    page_id: string;
    kind: string;
  },
): Promise<IncidentRow> {
  const existing = await env.DB.prepare(
    "SELECT id, workspace_id, entity_id, page_id, kind, opened_at, closed_at FROM incident WHERE page_id = ? AND closed_at IS NULL",
  )
    .bind(row.page_id)
    .first<IncidentRow>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO incident (id, workspace_id, entity_id, page_id, kind, opened_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      row.workspace_id,
      row.entity_id,
      row.page_id,
      row.kind,
      new Date().toISOString(),
    )
    .run();
  return {
    id,
    ...row,
    opened_at: new Date().toISOString(),
    closed_at: null,
  };
}

export async function openIncidentForPage(
  env: DataEnv,
  pageId: string,
): Promise<IncidentRow | null> {
  return env.DB.prepare(
    "SELECT id, workspace_id, entity_id, page_id, kind, opened_at, closed_at FROM incident WHERE page_id = ? AND closed_at IS NULL",
  )
    .bind(pageId)
    .first<IncidentRow>();
}

export async function closeIncident(
  env: DataEnv,
  incidentId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE incident SET closed_at = ? WHERE id = ? AND closed_at IS NULL",
  )
    .bind(new Date().toISOString(), incidentId)
    .run();
}

export async function recordIncidentNotice(
  env: DataEnv,
  row: {
    incident_id: string;
    page_id: string;
    is_resolution: boolean;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO incident_notice (id, incident_id, page_id, sent_on, sent_at, is_resolution) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      row.incident_id,
      row.page_id,
      today,
      new Date().toISOString(),
      row.is_resolution ? 1 : 0,
    )
    .run();
  return res.meta.changes > 0 ? id : null;
}

export async function rescindIncidentNotice(
  env: DataEnv,
  noticeId: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM incident_notice WHERE id = ?")
    .bind(noticeId)
    .run();
}
