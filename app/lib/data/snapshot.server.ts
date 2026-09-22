export function insertSnapshotStmt(
  db: D1Database,
  args: {
    id: string;
    watchId: string;
    fetchedAt: string;
    r2Key: string;
    hash: string;
    itemCount: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(args.id, args.watchId, args.fetchedAt, args.r2Key, args.hash, args.itemCount);
}
