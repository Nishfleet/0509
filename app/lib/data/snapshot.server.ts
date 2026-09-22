export function snapshotInsert(
  db: D1Database,
  row: {
    id: string;
    watchId: string;
    fetchedAt: string;
    payloadR2Key: string;
    payloadHash: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(row.id, row.watchId, row.fetchedAt, row.payloadR2Key, row.payloadHash);
}
