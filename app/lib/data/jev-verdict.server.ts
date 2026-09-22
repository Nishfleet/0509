export function insertVerdictStmt(
  db: D1Database,
  args: {
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
    .prepare(
      `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, entity_id, p, choice, reason, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (question_id, input_hash) DO NOTHING`,
    )
    .bind(
      args.id,
      args.workspaceId,
      args.questionId,
      args.inputHash,
      args.entityId,
      args.p,
      args.choice,
      args.reason,
      args.now,
    );
}
