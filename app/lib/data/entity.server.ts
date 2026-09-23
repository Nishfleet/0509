const INSERT_COMPETITOR = `INSERT OR IGNORE INTO entity
  (id, workspace_id, role, domain, name, origin, state, created_at)
  VALUES (?, ?, 'competitor', ?, ?, ?, 'on', ?)`;

const UPSERT_TRACKED_COMPETITOR = `INSERT INTO entity
  (id, workspace_id, role, domain, name, origin, state, created_at)
  VALUES (?, ?, 'competitor', ?, ?, ?, 'on', ?)
  ON CONFLICT(workspace_id, domain) DO UPDATE SET
    state = 'on', state_changed_by = 'user', state_changed_at = excluded.created_at`;

const SET_COMPETITOR_STATE = `UPDATE entity SET state = ?, state_changed_by = ?, state_changed_at = ?
  WHERE id = ? AND workspace_id = ? AND role = 'competitor'`;

const RETIRE_COMPETITOR = `UPDATE entity SET state = 'off', state_reason = ?,
  state_changed_by = 'jev', state_changed_at = ?
  WHERE id = ? AND workspace_id = ? AND state = 'on'`;

export function insertCompetitorEntityStmt(
	db: D1Database,
	row: {
		id: string;
		workspaceId: string;
		domain: string;
		name: string | null;
		origin: "auto" | "manual";
		now: string;
	},
): D1PreparedStatement {
	return db
		.prepare(INSERT_COMPETITOR)
		.bind(row.id, row.workspaceId, row.domain, row.name, row.origin, row.now);
}

export function upsertTrackedCompetitorStmt(
	db: D1Database,
	row: {
		id: string;
		workspaceId: string;
		domain: string;
		name: string | null;
		origin: "auto" | "manual";
		now: string;
	},
): D1PreparedStatement {
	return db
		.prepare(UPSERT_TRACKED_COMPETITOR)
		.bind(row.id, row.workspaceId, row.domain, row.name, row.origin, row.now);
}

export function setCompetitorStateStmt(
	db: D1Database,
	row: {
		entityId: string;
		workspaceId: string;
		state: "on" | "off" | "dismissed";
		changedBy: "user" | "jev";
		now: string;
	},
): D1PreparedStatement {
	return db
		.prepare(SET_COMPETITOR_STATE)
		.bind(row.state, row.changedBy, row.now, row.entityId, row.workspaceId);
}

export function retireCompetitorStmt(
	db: D1Database,
	row: { entityId: string; workspaceId: string; reason: string; now: string },
): D1PreparedStatement {
	return db
		.prepare(RETIRE_COMPETITOR)
		.bind(row.reason, row.now, row.entityId, row.workspaceId);
}
