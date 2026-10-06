const CLAIM_SLOT = `INSERT INTO support_issue (report_id, from_domain, created_at)
SELECT ?, ?, ?
WHERE (SELECT COUNT(*) FROM support_issue WHERE from_domain = ? AND created_at >= ?) < ?
  AND (SELECT COUNT(*) FROM support_issue WHERE created_at >= ?) < ?`;

const RELEASE_SLOT = "DELETE FROM support_issue WHERE report_id = ?";

const COUNT_RECENT = "SELECT COUNT(*) AS n FROM support_issue WHERE from_domain = ? AND created_at >= ?";

const DELETE_EXPIRED = "DELETE FROM support_issue WHERE created_at < ?";

const MAX_ISSUES_PER_DOMAIN_PER_DAY = 3;
const MAX_ISSUES_PER_DAY = 20;
const ISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface IssueSlot {
  reportId: string;
  fromDomain: string;
  at: string;
}

export async function claimIssueSlot(db: D1Database, slot: IssueSlot): Promise<boolean> {
  const cutoff = new Date(new Date(slot.at).getTime() - ISSUE_WINDOW_MS).toISOString();
  const result = await db
    .prepare(CLAIM_SLOT)
    .bind(
      slot.reportId,
      slot.fromDomain,
      slot.at,
      slot.fromDomain,
      cutoff,
      MAX_ISSUES_PER_DOMAIN_PER_DAY,
      cutoff,
      MAX_ISSUES_PER_DAY,
    )
    .run();
  return result.meta.changes > 0;
}

export async function releaseIssueSlot(db: D1Database, reportId: string): Promise<void> {
  await db.prepare(RELEASE_SLOT).bind(reportId).run();
}

export async function countRecentIssues(db: D1Database, fromDomain: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ISSUE_WINDOW_MS).toISOString();
  const row = await db.prepare(COUNT_RECENT).bind(fromDomain, cutoff).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deleteExpiredIssues(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  const result = await db.prepare(DELETE_EXPIRED).bind(cutoff).run();
  return result.meta.changes;
}
