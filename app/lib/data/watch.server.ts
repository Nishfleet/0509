export async function siteWatchIdForEntity(
  db: D1Database,
  entityId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT w.id FROM watch w JOIN source s ON s.id = w.source_id
       WHERE w.entity_id = ? AND s.kind = 'site' LIMIT 1`,
    )
    .bind(entityId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export function insertWatchStmt(
  db: D1Database,
  args: { id: string; entityId: string; sourceId: string; target: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
       VALUES (?,?,?,?,1,'{}') ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`,
    )
    .bind(args.id, args.entityId, args.sourceId, args.target);
}
