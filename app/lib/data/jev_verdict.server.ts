import { env } from "cloudflare:workers";

const SELECT_VERDICT = "SELECT p FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const SELECT_CHOICE = "SELECT choice FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const INSERT_VERDICT =
  "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, reason, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (question_id, input_hash) DO NOTHING";

export interface VerdictRow {
  workspaceId: string;
  questionId: string;
  inputHash: string;
  signalId: string | null;
  entityId: string | null;
  p: number | null;
  choice: string | null;
  reason: string | null;
  decidedAt: string;
}

export async function readCachedNoul(questionId: string, inputHash: string): Promise<number | null> {
  const row = await env.DB.prepare(SELECT_VERDICT).bind(questionId, inputHash).first<{ p: number | null }>();
  return row?.p ?? null;
}

export async function readCachedChoice(questionId: string, inputHash: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_CHOICE).bind(questionId, inputHash).first<{ choice: string | null }>();
  return row?.choice ?? null;
}

export function insertVerdict(row: VerdictRow): D1PreparedStatement {
  return env.DB.prepare(INSERT_VERDICT).bind(
    crypto.randomUUID(),
    row.workspaceId,
    row.questionId,
    row.inputHash,
    row.signalId,
    row.entityId,
    row.p,
    row.choice,
    row.reason,
    row.decidedAt,
  );
}
