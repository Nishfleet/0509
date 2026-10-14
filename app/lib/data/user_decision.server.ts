import { z } from "zod";

import { env } from "cloudflare:workers";

import { DRAFT_FIELDS, type DraftField } from "../identity/card-fields";

export type SubjectVerdict = "public_subject:confirmed" | "public_subject:refused";

const FIELD_EDIT_VERDICT = "identity_field:edited";

export interface FieldEdit {
  field: DraftField;
  from: string | null;
  to: string;
}

const INSERT_SUBJECT_DECISION = `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
SELECT ?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6
WHERE EXISTS (SELECT 1 FROM workspace WHERE id = ?2) AND EXISTS (SELECT 1 FROM "user" WHERE id = ?3)`;

const INSERT_FIELD_EDIT = `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
SELECT ?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7
WHERE EXISTS (SELECT 1 FROM workspace WHERE id = ?2) AND EXISTS (SELECT 1 FROM "user" WHERE id = ?3)`;

const SELECT_SUBJECT_DECISION = `SELECT verdict FROM user_decision
WHERE workspace_id = ?1 AND note = ?2 AND verdict IN ('public_subject:confirmed','public_subject:refused')
ORDER BY decided_at DESC LIMIT 1`;

const SELECT_FIELD_EDITS = `SELECT note FROM user_decision
WHERE workspace_id = ?1 AND entity_id = ?2 AND verdict = ?3`;

const fieldEditNoteSchema = z.object({ field: z.enum(DRAFT_FIELDS) });

const readEditedFieldsRow = z.object({ note: z.string() });

const readSubjectDecisionRow = z.object({
  verdict: z.enum(["public_subject:confirmed", "public_subject:refused"]),
});

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

export async function insertFieldEdits(
  rows: {
    workspaceId: string;
    userId: string;
    entityId: string;
    edit: FieldEdit;
    decidedAt: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(INSERT_FIELD_EDIT).bind(
        crypto.randomUUID(),
        row.workspaceId,
        row.userId,
        row.entityId,
        FIELD_EDIT_VERDICT,
        JSON.stringify(row.edit),
        row.decidedAt,
      ),
    ),
  );
}

export async function readEditedFields(workspaceId: string, entityId: string): Promise<DraftField[]> {
  const rows = z
    .array(readEditedFieldsRow)
    .parse((await env.DB.prepare(SELECT_FIELD_EDITS).bind(workspaceId, entityId, FIELD_EDIT_VERDICT).all()).results);
  const fields = rows.flatMap((row) => {
    try {
      const result = fieldEditNoteSchema.safeParse(JSON.parse(row.note));
      return result.success ? [result.data.field] : [];
    } catch (error) {
      console.error(JSON.stringify({ event: "identity_field_edit.note_unreadable", error: String(error) }));
      return [];
    }
  });
  return [...new Set(fields)];
}

export async function readSubjectDecision(workspaceId: string, subject: string): Promise<SubjectVerdict | null> {
  const row = readSubjectDecisionRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_SUBJECT_DECISION).bind(workspaceId, subject).first());
  return row?.verdict ?? null;
}

const CLEAR_CHANGE_FEEDBACK = `DELETE FROM user_decision
WHERE workspace_id = ?1 AND signal_id = ?2 AND verdict LIKE 'change_feedback:%'`;

const INSERT_CHANGE_FEEDBACK = `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
SELECT ?1, s.workspace_id, ?3, s.id, s.entity_id, ?4, NULL, ?5
FROM signal s
WHERE s.id = ?2 AND s.workspace_id = ?6 AND s.kind = 'change' AND EXISTS (SELECT 1 FROM "user" WHERE id = ?3)`;

export async function recordChangeFeedback(row: {
  workspaceId: string;
  userId: string;
  signalId: string;
  useful: boolean;
  decidedAt: string;
}): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(CLEAR_CHANGE_FEEDBACK).bind(row.workspaceId, row.signalId),
    env.DB.prepare(INSERT_CHANGE_FEEDBACK).bind(
      crypto.randomUUID(),
      row.signalId,
      row.userId,
      row.useful ? "change_feedback:useful" : "change_feedback:not_useful",
      row.decidedAt,
      row.workspaceId,
    ),
  ]);
}
