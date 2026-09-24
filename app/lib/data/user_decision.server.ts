import { env } from "cloudflare:workers";

export type SubjectVerdict = "public_subject:confirmed" | "public_subject:refused";

const INSERT_SUBJECT_DECISION =
  "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6)";

const SELECT_SUBJECT_DECISION = `SELECT verdict FROM user_decision
WHERE workspace_id = ?1 AND note = ?2 AND verdict IN ('public_subject:confirmed','public_subject:refused')
ORDER BY decided_at DESC LIMIT 1`;

export async function insertSubjectDecision(row: {
  workspaceId: string;
  userId: string;
  subject: string;
  verdict: SubjectVerdict;
  decidedAt: string;
}): Promise<void> {
  await env.DB.prepare(INSERT_SUBJECT_DECISION)
    .bind(crypto.randomUUID(), row.workspaceId, row.userId, row.verdict, row.subject, row.decidedAt)
    .run();
}

export async function readSubjectDecision(workspaceId: string, subject: string): Promise<SubjectVerdict | null> {
  const row = await env.DB.prepare(SELECT_SUBJECT_DECISION)
    .bind(workspaceId, subject)
    .first<{ verdict: SubjectVerdict }>();
  return row?.verdict ?? null;
}
