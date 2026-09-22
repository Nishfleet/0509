import { env } from "cloudflare:workers";

interface UserDecisionInput {
  workspaceId: string;
  userId: string;
  entityId?: string | null;
  verdict: string;
  note?: string | null;
}

export function userDecisionStmts(db: D1Database, rows: UserDecisionInput[]): D1PreparedStatement[] {
  const now = new Date().toISOString();
  return rows.map((r) =>
    db
      .prepare(
        `INSERT INTO user_decision (id, workspace_id, user_id, entity_id, verdict, note, decided_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(crypto.randomUUID(), r.workspaceId, r.userId, r.entityId ?? null, r.verdict, r.note ?? null, now),
  );
}

async function insertUserDecisions(db: D1Database, rows: UserDecisionInput[]): Promise<void> {
  const stmts = userDecisionStmts(db, rows);
  if (!stmts.length) return;
  await db.batch(stmts);
}

export async function priorRefusalExists(
  db: D1Database,
  workspaceId: string,
  note: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM user_decision WHERE workspace_id = ? AND verdict LIKE 'refused:%' AND note = ? LIMIT 1`,
    )
    .bind(workspaceId, note)
    .first<{ id: string }>();
  return row !== null;
}

export async function recordIdentityEdits(args: {
  workspaceId: string;
  userId: string;
  entityId: string;
  edits: Record<string, string>;
}): Promise<void> {
  await insertUserDecisions(
    env.DB,
    Object.entries(args.edits).map(([field, value]) => ({
      workspaceId: args.workspaceId,
      userId: args.userId,
      entityId: args.entityId,
      verdict: `identity_edit:${field}`,
      note: value,
    })),
  );
}
