import { addManualCompetitor, setCompetitorState } from "./data/entity.server";
import { readCompetitorCap } from "./data/plan.server";
import { acceptSuggestion, confirmRetireSuggestion, dismissSuggestion, keepFromRetireSuggestion } from "./data/suggestion.server";
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
    return { message: "We couldn't read that. Try their main website, like brand.com." };
  }
  const domain = normalised.subject.registrable;
  if (await isTakenDown(domain)) return { message: "That brand asked not to be tracked, so we can't add it." };
  const cap = await readCompetitorCap(workspaceId);
  const outcome = await addManualCompetitor({ workspaceId, domain, now, cap });
  if (outcome === "at_cap") {
    return { message: `Your plan watches up to ${String(cap)} competitors. Switch one off to add another.` };
  }
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
  if (intent === "stop" && suggestionId !== "") {
    await confirmRetireSuggestion({ workspaceId, suggestionId, now });
    return DONE;
  }
  if (intent === "keep" && suggestionId !== "") {
    await keepFromRetireSuggestion({ workspaceId, suggestionId, now });
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
