import { env } from "cloudflare:workers";

const SELECT_VERDICT = "SELECT p FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const SELECT_CHOICE = "SELECT choice FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const SELECT_LAST_STILL_COMPETITOR =
  "SELECT choice, decided_at FROM jev_verdict WHERE workspace_id = ?1 AND entity_id = ?2 AND question_id = 'still_competitor_reason' AND choice IS NOT NULL ORDER BY decided_at DESC LIMIT 1";

const INSERT_VERDICT =
  "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, reason, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (question_id, input_hash) DO NOTHING";

export interface StillCompetitorVerdict {
  choice: string;
  decidedAt: string;
}

interface StillCompetitorRow {
  choice: string;
  decided_at: string;
}

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

export async function insertVerdicts(rows: readonly VerdictRow[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(rows.map(insertVerdict));
}

export async function readCachedNoul(questionId: string, inputHash: string): Promise<number | null> {
  const row = await env.DB.prepare(SELECT_VERDICT).bind(questionId, inputHash).first<{ p: number | null }>();
  return row?.p ?? null;
}

export async function readCachedChoice(questionId: string, inputHash: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_CHOICE).bind(questionId, inputHash).first<{ choice: string | null }>();
  return row?.choice ?? null;
}

export async function readLastStillCompetitor(
  workspaceId: string,
  entityId: string,
): Promise<StillCompetitorVerdict | null> {
  const row = await env.DB.prepare(SELECT_LAST_STILL_COMPETITOR)
    .bind(workspaceId, entityId)
    .first<StillCompetitorRow>();
  if (row === null) {
    return null;
  }
  return { choice: row.choice, decidedAt: row.decided_at };
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
