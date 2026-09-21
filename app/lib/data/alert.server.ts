/**
 * `alert` — the feed rows a breakage lands in immediately, inside the same
 * tick that saw it, never on the weekly cadence.
 */
import type { DataEnv } from "./entity.server";

export async function insertAlert(
  env: DataEnv,
  row: {
    workspace_id: string;
    entity_id?: string | null;
    signal_id?: string | null;
    page_id?: string | null;
    incident_id?: string | null;
    kind: string;
    severity?: string;
    title: string;
    body?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO alert
       (id, workspace_id, entity_id, signal_id, page_id, incident_id, kind, severity, title, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)`,
  )
    .bind(
      id,
      row.workspace_id,
      row.entity_id ?? null,
      row.signal_id ?? null,
      row.page_id ?? null,
      row.incident_id ?? null,
      row.kind,
      row.severity ?? "normal",
      row.title,
      row.body ?? null,
      new Date().toISOString(),
    )
    .run();
  return id;
}
