const CLAIM_NOTICE = `INSERT INTO incident_notice
  (id, incident_id, page_id, sent_on, sent_at, is_resolution)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(page_id, sent_on, is_resolution) DO UPDATE
  SET sent_at = excluded.sent_at
  WHERE incident_notice.incident_id = excluded.incident_id
RETURNING id`;

export interface IncidentNoticeInput {
  incidentId: string;
  pageId: string;
  now: Date;
  isResolution: 0 | 1;
}

export async function claimIncidentNotice(
  db: D1Database,
  input: IncidentNoticeInput,
): Promise<{ id: string } | null> {
  return db
    .prepare(CLAIM_NOTICE)
    .bind(
      crypto.randomUUID(),
      input.incidentId,
      input.pageId,
      input.now.toISOString().slice(0, 10),
      input.now.toISOString(),
      input.isResolution,
    )
    .first<{ id: string }>();
}
