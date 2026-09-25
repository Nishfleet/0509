import type { CardDraft, DraftField } from "./card-fields";
import {
  clearDraftField,
  draftKey,
  readDraft,
  saveDraftField,
} from "./card-draft-internal.server";
import { normaliseSubject } from "./normalise";

export { draftKey, readDraft };
export type { CardDraft, DraftField };

export async function applyDraftIntent(workspaceId: string, form: FormData): Promise<boolean> {
  const intent = form.get("intent");
  if (intent !== "draft" && intent !== "revert") return false;
  const draftSubject = form.get("subject");
  const field = form.get("field");
  const value = form.get("value");
  if (typeof draftSubject === "string" && (field === "name" || field === "description")) {
    const normalised = normaliseSubject(draftSubject);
    if (normalised.ok) {
      if (intent === "draft" && typeof value === "string") {
        await saveDraftField(workspaceId, normalised.subject.registrable, field, value);
      }
      if (intent === "revert") {
        await clearDraftField(workspaceId, normalised.subject.registrable, field);
      }
    }
  }
  return true;
}
