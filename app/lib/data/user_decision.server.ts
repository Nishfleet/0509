import { z } from "zod";

import { env } from "cloudflare:workers";

import type { DraftField } from "../identity/card-fields";

export type SubjectVerdict = "public_subject:confirmed" | "public_subject:refused";

const FIELD_EDIT_VERDICT = "identity_field:edited";

export interface FieldEdit {
  field: DraftField;
  from: string | null;
  to: string;
}

const INSERT_SUBJECT_DECISION =
  "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6)";

const INSERT_FIELD_EDIT =
  "INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)";

const SELECT_SUBJECT_DECISION = `SELECT verdict FROM user_decision
WHERE workspace_id = ?1 AND note = ?2 AND verdict IN ('public_subject:confirmed','public_subject:refused')
ORDER BY decided_at DESC LIMIT 1`;

const SELECT_FIELD_EDITS = `SELECT note FROM user_decision
WHERE entity_id = ?1 AND verdict = ?2`;

const fieldEditNoteSchema = z.object({ field: z.enum(["name", "description"]) });

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
      env.DB
        .prepare(INSERT_FIELD_EDIT)
        .bind(
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

export async function readEditedFields(entityId: string): Promise<DraftField[]> {
  const rows = await env.DB.prepare(SELECT_FIELD_EDITS)
    .bind(entityId, FIELD_EDIT_VERDICT)
    .all<{ note: string }>();
  const fields: DraftField[] = [];
  const seen = new Set<DraftField>();
  for (const row of rows.results) {
    try {
      const parsed = JSON.parse(row.note) as unknown;
      const result = fieldEditNoteSchema.safeParse(parsed);
      if (!result.success) continue;
      if (seen.has(result.data.field)) continue;
      seen.add(result.data.field);
      fields.push(result.data.field);
    } catch {
      continue;
    }
  }
  return fields;
}

export async function readSubjectDecision(workspaceId: string, subject: string): Promise<SubjectVerdict | null> {
  const row = await env.DB.prepare(SELECT_SUBJECT_DECISION)
    .bind(workspaceId, subject)
    .first<{ verdict: SubjectVerdict }>();
  return row?.verdict ?? null;
}
