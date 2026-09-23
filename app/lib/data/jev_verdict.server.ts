const INSERT_VERDICT = `INSERT OR IGNORE INTO jev_verdict
  (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function insertVerdictStmt(
	db: D1Database,
	row: {
		id: string;
		workspaceId: string;
		questionId: string;
		inputHash: string;
		entityId: string | null;
		p: number | null;
		choice: string | null;
		reason: string | null;
		now: string;
	},
): D1PreparedStatement {
	return db
		.prepare(INSERT_VERDICT)
		.bind(
			row.id,
			row.workspaceId,
			row.questionId,
			row.inputHash,
			row.entityId,
			row.p,
			row.choice,
			row.reason,
			row.now,
		);
}
