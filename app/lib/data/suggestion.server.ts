const UPSERT_ACCEPTED = `INSERT INTO suggestion
  (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
   evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
  VALUES (?, ?, ?, 'add', ?, ?, ?, ?, ?, 'auto_on', 'jev', ?, ?)
  ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
    entity_id = COALESCE(suggestion.entity_id, excluded.entity_id),
    verdict_p = excluded.verdict_p,
    verdict_reason = excluded.verdict_reason,
    evidence_json = excluded.evidence_json,
    status = CASE WHEN suggestion.status = 'pending' THEN 'auto_on' ELSE suggestion.status END,
    decided_by = CASE WHEN suggestion.status = 'pending' THEN 'jev' ELSE suggestion.decided_by END,
    decided_at = CASE WHEN suggestion.status = 'pending' THEN excluded.decided_at ELSE suggestion.decided_at END`;

const UPSERT_DROPPED = `INSERT INTO suggestion
  (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
   evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
  VALUES (?, ?, NULL, 'add', ?, ?, ?, ?, ?, 'dismissed', 'jev', ?, ?)
  ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
    verdict_p = excluded.verdict_p,
    verdict_reason = excluded.verdict_reason,
    evidence_json = excluded.evidence_json,
    status = CASE WHEN suggestion.status = 'pending' THEN 'dismissed' ELSE suggestion.status END,
    decided_by = CASE WHEN suggestion.status = 'pending' THEN 'jev' ELSE suggestion.decided_by END,
    decided_at = CASE WHEN suggestion.status = 'pending' THEN excluded.decided_at ELSE suggestion.decided_at END`;

const UPSERT_MAYBE = `INSERT INTO suggestion
  (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
   evidence_json, verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
  VALUES (?, ?, ?, 'add', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
    verdict_p = excluded.verdict_p,
    verdict_reason = excluded.verdict_reason,
    evidence_json = excluded.evidence_json,
    status = CASE WHEN suggestion.status = 'pending' THEN excluded.status ELSE suggestion.status END`;

const INSERT_UNJUDGED = `INSERT OR IGNORE INTO suggestion
  (id, workspace_id, kind, candidate_domain, candidate_name,
   evidence_json, status, created_at)
  VALUES (?, ?, 'add', ?, ?, ?, 'pending', ?)`;

const UPSERT_RETIRE_ASK = `INSERT INTO suggestion
  (id, workspace_id, entity_id, kind, candidate_domain,
   verdict_p, verdict_reason, status, decided_by, decided_at, created_at)
  VALUES (?, ?, ?, 'retire', ?, ?, ?, 'pending', 'jev', ?, ?)
  ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
    verdict_p = excluded.verdict_p,
    verdict_reason = excluded.verdict_reason,
    status = CASE WHEN suggestion.status = 'pending' THEN 'pending' ELSE suggestion.status END`;

const DISMISS_BY_DOMAIN = `INSERT INTO suggestion
  (id, workspace_id, kind, candidate_domain, status, decided_by, decided_at, created_at)
  VALUES (?, ?, 'add', ?, 'dismissed', 'user', ?, ?)
  ON CONFLICT(workspace_id, candidate_domain) DO UPDATE SET
    status = 'dismissed', decided_by = 'user', decided_at = excluded.decided_at`;

const SET_STATUS = `UPDATE suggestion SET status = ?, decided_by = 'user', decided_at = ?
  WHERE id = ? AND workspace_id = ?`;

const INSERT_PENDING_NAME = `INSERT OR IGNORE INTO suggestion
  (id, workspace_id, kind, candidate_domain, candidate_name, status, created_at)
  VALUES (?, ?, 'add', ?, ?, 'pending', ?)`;

interface SuggestionRowBase {
	id: string;
	workspaceId: string;
	domain: string;
	name: string | null;
	now: string;
}

interface JudgedSuggestionRow extends SuggestionRowBase {
	entityId: string | null;
	evidenceJson: string;
	p: number | null;
	reason: string | null;
}

export function upsertAcceptedSuggestionStmt(
	db: D1Database,
	row: JudgedSuggestionRow,
): D1PreparedStatement {
	return db
		.prepare(UPSERT_ACCEPTED)
		.bind(
			row.id,
			row.workspaceId,
			row.entityId,
			row.domain,
			row.name,
			row.evidenceJson,
			row.p,
			row.reason,
			row.now,
			row.now,
		);
}

export function upsertDroppedSuggestionStmt(
	db: D1Database,
	row: JudgedSuggestionRow,
): D1PreparedStatement {
	return db
		.prepare(UPSERT_DROPPED)
		.bind(
			row.id,
			row.workspaceId,
			row.domain,
			row.name,
			row.evidenceJson,
			row.p,
			row.reason,
			row.now,
			row.now,
		);
}

export function upsertMaybeSuggestionStmt(
	db: D1Database,
	row: JudgedSuggestionRow & { decidedBy: string | null; decidedAt: string | null },
): D1PreparedStatement {
	return db
		.prepare(UPSERT_MAYBE)
		.bind(
			row.id,
			row.workspaceId,
			row.entityId,
			row.domain,
			row.name,
			row.evidenceJson,
			row.p,
			row.reason,
			row.decidedBy,
			row.decidedAt,
			row.now,
		);
}

export function insertUnjudgedSuggestionStmt(
	db: D1Database,
	row: SuggestionRowBase & { evidenceJson: string },
): D1PreparedStatement {
	return db
		.prepare(INSERT_UNJUDGED)
		.bind(row.id, row.workspaceId, row.domain, row.name, row.evidenceJson, row.now);
}

export function upsertRetireAskStmt(
	db: D1Database,
	row: {
		id: string;
		workspaceId: string;
		entityId: string;
		domain: string;
		p: number | null;
		reason: string | null;
		now: string;
	},
): D1PreparedStatement {
	return db
		.prepare(UPSERT_RETIRE_ASK)
		.bind(row.id, row.workspaceId, row.entityId, row.domain, row.p, row.reason, row.now, row.now);
}

export function dismissSuggestionByDomainStmt(
	db: D1Database,
	row: { id: string; workspaceId: string; domain: string; now: string },
): D1PreparedStatement {
	return db.prepare(DISMISS_BY_DOMAIN).bind(row.id, row.workspaceId, row.domain, row.now, row.now);
}

export function setSuggestionStatusStmt(
	db: D1Database,
	row: { id: string; workspaceId: string; status: "accepted" | "dismissed"; now: string },
): D1PreparedStatement {
	return db.prepare(SET_STATUS).bind(row.status, row.now, row.id, row.workspaceId);
}

export function insertPendingNameSuggestionStmt(
	db: D1Database,
	row: SuggestionRowBase,
): D1PreparedStatement {
	return db
		.prepare(INSERT_PENDING_NAME)
		.bind(row.id, row.workspaceId, row.domain, row.name, row.now);
}
