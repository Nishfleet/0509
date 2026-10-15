import { z } from "zod";

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

const claimIncidentNoticeRow = z.object({ id: z.string() });

export async function claimIncidentNotice(db: D1Database, input: IncidentNoticeInput): Promise<{ id: string } | null> {
  return claimIncidentNoticeRow
    .nullable()
    .parse(
      await db
        .prepare(CLAIM_NOTICE)
        .bind(
          crypto.randomUUID(),
          input.incidentId,
          input.pageId,
          input.now.toISOString().slice(0, 10),
          input.now.toISOString(),
          input.isResolution,
        )
        .first(),
    );
}

const ANNOUNCED_NOTICE = `SELECT 1 AS announced FROM send_attempt WHERE idempotency_key = ?1 AND status = 'sent'`;
const announcedRow = z.object({ announced: z.literal(1) }).nullable();

export async function incidentWasAnnounced(db: D1Database, incidentId: string): Promise<boolean> {
  return announcedRow.parse(await db.prepare(ANNOUNCED_NOTICE).bind(`incident:${incidentId}:open`).first()) !== null;
}
