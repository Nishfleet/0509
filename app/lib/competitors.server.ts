import { addManualCompetitor, setCompetitorState } from "./data/entity.server";
import { acceptSuggestion, dismissSuggestion } from "./data/suggestion.server";
import { isTakenDown } from "./data/takedown.server";
import { normaliseSubject } from "./identity/normalise";

export interface CompetitorActionResult {
  message: string | null;
}

const DONE: CompetitorActionResult = { message: null };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function addCompetitor(workspaceId: string, raw: string, now: string): Promise<CompetitorActionResult> {
  const normalised = normaliseSubject(raw);
  if (!normalised.ok || normalised.subject.kind !== "domain") {
    return { message: "we couldn't read that, try their main website, like brand.com" };
  }
  const domain = normalised.subject.registrable;
  if (await isTakenDown(domain)) return { message: "we can't track that brand" };
  await addManualCompetitor({ workspaceId, domain, now });
  return DONE;
}

export async function handleCompetitorIntent(workspaceId: string, form: FormData): Promise<CompetitorActionResult> {
  const now = new Date().toISOString();
  const intent = text(form, "intent");
  const suggestionId = text(form, "suggestionId");
  const entityId = text(form, "entityId");
  if (intent === "accept" && suggestionId !== "") {
    await acceptSuggestion({ workspaceId, suggestionId, now });
    return DONE;
  }
  if (intent === "dismiss" && suggestionId !== "") {
    await dismissSuggestion({ workspaceId, suggestionId, now });
    return DONE;
  }
  if ((intent === "on" || intent === "off") && entityId !== "") {
    await setCompetitorState(workspaceId, entityId, intent, now);
    return DONE;
  }
  if (intent === "add") return addCompetitor(workspaceId, text(form, "competitor"), now);
  return DONE;
}
