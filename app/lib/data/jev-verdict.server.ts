/**
 * `jev_verdict` — every judgment logged once: question id, input hash, p,
 * reason, timestamp. UNIQUE(question_id, input_hash) makes "same question,
 * same input = cached verdict, never a second call" a database fact
 * (docs/REBUILD-JEV.md principle 3), not a discipline.
 */
import type { DataEnv } from "./entity.server";

export interface VerdictRow {
  id: string;
  question_id: string;
  input_hash: string;
  p: number | null;
  choice: string | null;
  reason: string | null;
  decided_at: string;
}

export async function findVerdict(
  env: DataEnv,
  questionId: string,
  inputHash: string,
): Promise<VerdictRow | null> {
  return env.DB.prepare(
    "SELECT id, question_id, input_hash, p, choice, reason, decided_at FROM jev_verdict WHERE question_id = ? AND input_hash = ?",
  )
    .bind(questionId, inputHash)
    .first<VerdictRow>();
}

export async function insertVerdict(
  env: DataEnv,
  row: {
    workspace_id: string;
    question_id: string;
    input_hash: string;
    signal_id?: string | null;
    entity_id?: string | null;
    p?: number | null;
    choice?: string | null;
    reason?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO jev_verdict
       (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, reason, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      row.workspace_id,
      row.question_id,
      row.input_hash,
      row.signal_id ?? null,
      row.entity_id ?? null,
      row.p ?? null,
      row.choice ?? null,
      row.reason ?? null,
      new Date().toISOString(),
    )
    .run();
  return id;
}
