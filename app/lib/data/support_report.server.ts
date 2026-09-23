const INSERT_REPORT = `INSERT INTO support_report
  (id, received_at, from_domain, subject_sha256, raw)
VALUES (?, ?, ?, ?, ?)`;

const DELETE_EXPIRED_REPORTS = `DELETE FROM support_report WHERE received_at < ?`;

export interface SupportReportRow {
  id: string;
  receivedAt: string;
  fromDomain: string;
  subjectSha256: string;
  raw: string;
}

export async function insertSupportReport(
  db: D1Database,
  row: SupportReportRow,
): Promise<void> {
  await db
    .prepare(INSERT_REPORT)
    .bind(row.id, row.receivedAt, row.fromDomain, row.subjectSha256, row.raw)
    .run();
}

export async function deleteExpiredSupportReports(
  db: D1Database,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare(DELETE_EXPIRED_REPORTS).bind(cutoff).run();
  return result.meta.changes;
}
