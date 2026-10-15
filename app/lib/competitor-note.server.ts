import { saveEntityNote } from "./data/entity_note.server";
import { noteRefusal } from "./entity-note";

export async function saveCompetitorNote(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const body = raw.trim();
  const refusal = noteRefusal(body);
  if (refusal !== null) return { ok: false, message: refusal };
  const saved = await saveEntityNote({ workspaceId, entityId, body, now: new Date().toISOString() });
  return saved ? { ok: true } : { ok: false, message: "We don't track that competitor." };
}
