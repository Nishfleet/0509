const INSERT_SNAPSHOT = `INSERT INTO snapshot
  (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
  VALUES (?, ?, ?, ?, ?, ?)`;

export function insertSnapshotStmt(
	db: D1Database,
	row: {
		id: string;
		watchId: string;
		fetchedAt: string;
		payloadR2Key: string | null;
		payloadHash: string;
		itemCount: number;
	},
): D1PreparedStatement {
	return db
		.prepare(INSERT_SNAPSHOT)
		.bind(row.id, row.watchId, row.fetchedAt, row.payloadR2Key, row.payloadHash, row.itemCount);
}
