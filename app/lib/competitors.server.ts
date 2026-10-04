import { nameFromDomain } from "./competitor/domain-name";
import { readCompetitorName } from "./competitor/site-name.server";
import { addManualCompetitor, readCompetitor, setCompetitorState } from "./data/entity.server";
import { nextPlan, type PlanId } from "./billing/plans";
import { readEntitlements, readPlanTier } from "./data/plan.server";
import {
  acceptSuggestion,
  confirmRetireSuggestion,
  dismissSuggestion,
  keepFromRetireSuggestion,
} from "./data/suggestion.server";
import { isTakenDown } from "./data/takedown.server";
import { resolveDomain } from "./discovery/resolve-domain.server";
import { normaliseSubject } from "./identity/normalise";

export interface CompetitorActionResult {
  message: string | null;
  upgradePlanId?: PlanId | null;
}

const DONE: CompetitorActionResult = { message: null };
const COULD_NOT_READ: CompetitorActionResult = {
  message: "We couldn't read that. Try their main website, like brand.com.",
};
const UNRESOLVED: CompetitorActionResult = {
  message: "We couldn't find that brand's website. Try their main website, like brand.com.",
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function upgradePlanIdFor(workspaceId: string): Promise<PlanId | null> {
  const next = nextPlan(await readPlanTier(workspaceId));
  return next === null ? null : next.id;
}

async function capRefusal(workspaceId: string, cap: number): Promise<CompetitorActionResult> {
  return {
    message: `Your plan watches up to ${String(cap)} competitors. Switch one off to add another.`,
    upgradePlanId: await upgradePlanIdFor(workspaceId),
  };
}

type Target = { domain: string; name: string | null } | CompetitorActionResult;

async function targetOf(raw: string, normalised: ReturnType<typeof normaliseSubject>): Promise<Target> {
  if (normalised.ok) {
    const { registrable } = normalised.subject;
    return { domain: registrable, name: (await readCompetitorName(registrable)) ?? nameFromDomain(registrable) };
  }
  const resolution = await resolveDomain(raw.trim());
  return resolution.domain === null ? UNRESOLVED : { domain: resolution.domain, name: raw.trim() };
}

async function addCompetitor(workspaceId: string, raw: string, now: string): Promise<CompetitorActionResult> {
  const normalised = normaliseSubject(raw);
  if (normalised.ok && normalised.subject.kind !== "domain") return COULD_NOT_READ;
  if (!normalised.ok && normalised.reason === "empty") return COULD_NOT_READ;

  const target = await targetOf(raw, normalised);
  if ("message" in target) return target;
  const { domain, name } = target;

  if (await isTakenDown(domain)) return { message: "That brand asked not to be tracked, so we can't add it." };
  const cap = (await readEntitlements(workspaceId)).competitors;
  const outcome = await addManualCompetitor({
    workspaceId,
    domain,
    name,
    url: normalised.ok ? normalised.subject.url : null,
    now,
    cap,
  });
  return outcome === "at_cap" ? capRefusal(workspaceId, cap) : DONE;
}

const SUGGESTION_INTENTS = new Map([
  ["stop", confirmRetireSuggestion],
  ["keep", keepFromRetireSuggestion],
  ["dismiss", dismissSuggestion],
]);

async function refusedAtCap(workspaceId: string): Promise<CompetitorActionResult> {
  return capRefusal(workspaceId, (await readEntitlements(workspaceId)).competitors);
}

async function switchRival(input: { workspaceId: string; entityId: string; state: "on" | "off"; now: string }) {
  const { workspaceId, entityId, state } = input;
  const changed = await setCompetitorState(input);
  if (changed || state === "off") return DONE;
  const rival = await readCompetitor(workspaceId, entityId);
  return rival?.state === "off" ? refusedAtCap(workspaceId) : DONE;
}

export async function handleCompetitorIntent(workspaceId: string, form: FormData): Promise<CompetitorActionResult> {
  const now = new Date().toISOString();
  const intent = text(form, "intent");
  const suggestionId = text(form, "suggestionId");
  const entityId = text(form, "entityId");
  const suggestionAction = SUGGESTION_INTENTS.get(intent);
  if (suggestionAction !== undefined && suggestionId !== "") {
    await suggestionAction({ workspaceId, suggestionId, now });
    return DONE;
  }
  if (intent === "accept" && suggestionId !== "") {
    const outcome = await acceptSuggestion({ workspaceId, suggestionId, now });
    return outcome === "at_cap" ? refusedAtCap(workspaceId) : DONE;
  }
  if ((intent === "on" || intent === "off") && entityId !== "")
    return switchRival({ workspaceId, entityId, state: intent, now });
  if (intent === "add") return addCompetitor(workspaceId, text(form, "competitor"), now);
  return DONE;
}
