import { idHash } from "./ids.server";

const INSERT_WATCH = `INSERT OR IGNORE INTO watch
  (id, entity_id, source_id, target_key) VALUES (?, ?, ?, ?)`;

const SET_WATCHES_ACTIVE = `UPDATE watch SET is_active = ? WHERE entity_id = ?`;

export async function watchStatements(
	db: D1Database,
	entityId: string,
	targetKey: string,
): Promise<D1PreparedStatement[]> {
	const sources = await db
		.prepare("SELECT id FROM source WHERE is_enabled = 1 AND key NOT LIKE 'discovery.%'")
		.all<{ id: string }>();
	const stmts: D1PreparedStatement[] = [];
	for (const source of sources.results) {
		const id = `wat_${await idHash(entityId, source.id, targetKey)}`;
		stmts.push(db.prepare(INSERT_WATCH).bind(id, entityId, source.id, targetKey));
	}
	return stmts;
}

export function insertWatchStmt(
	db: D1Database,
	row: { id: string; entityId: string; sourceId: string; targetKey: string },
): D1PreparedStatement {
	return db.prepare(INSERT_WATCH).bind(row.id, row.entityId, row.sourceId, row.targetKey);
}

export function setEntityWatchesActiveStmt(
	db: D1Database,
	entityId: string,
	active: boolean,
): D1PreparedStatement {
	return db.prepare(SET_WATCHES_ACTIVE).bind(active ? 1 : 0, entityId);
}
