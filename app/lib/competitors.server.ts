import { env } from "cloudflare:workers";

import { nameFromDomain } from "./competitor/domain-name";
import { readCompetitorName } from "./competitor/site-name.server";
import { addManualCompetitor, readCompetitor, setCompetitorState } from "./data/entity.server";
import { nextPlan, type PlanId } from "./billing/plans";
import { readEntitlements, readPlanTier } from "./data/plan.server";
import { withinProbeLimit } from "./identity/card.server";
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
const PROBE_LIMITED: CompetitorActionResult = {
  message: "You've tried a lot of addresses in the last minute. Wait a minute, then try again.",
};

const COUNT_OTHER_ON =
  "SELECT count(*) AS n FROM entity WHERE workspace_id = ? AND role = 'competitor' AND state = 'on' AND domain <> ?";
const SELECT_OWNER = "SELECT owner_user_id FROM workspace WHERE id = ?";

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

async function otherOnCount(workspaceId: string, exceptDomain: string): Promise<number | null> {
  const row = await env.DB.prepare(COUNT_OTHER_ON).bind(workspaceId, exceptDomain).first<{ n: number }>();
  return row === null ? null : row.n;
}

async function workspaceOwnerId(workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_OWNER).bind(workspaceId).first<{ owner_user_id: string }>();
  return row === null ? null : row.owner_user_id;
}

function unreadableAdd(normalised: ReturnType<typeof normaliseSubject>): CompetitorActionResult | null {
  if (normalised.ok) return normalised.subject.kind === "domain" ? null : COULD_NOT_READ;
  return normalised.reason === "empty" ? COULD_NOT_READ : null;
}

async function refusedBeforeFetch(
  workspaceId: string,
  cap: number,
  normalised: ReturnType<typeof normaliseSubject>,
): Promise<CompetitorActionResult | null> {
  const exceptDomain = normalised.ok ? normalised.subject.registrable : "";
  const onCount = await otherOnCount(workspaceId, exceptDomain);
  if (onCount !== null && onCount >= cap) return capRefusal(workspaceId, cap);
  const owner = await workspaceOwnerId(workspaceId);
  if (owner === null) return COULD_NOT_READ;
  if (!(await withinProbeLimit(owner))) return PROBE_LIMITED;
  return null;
}

async function addCompetitor(workspaceId: string, raw: string, now: string): Promise<CompetitorActionResult> {
  const normalised = normaliseSubject(raw);
  const unread = unreadableAdd(normalised);
  if (unread !== null) return unread;
  const cap = (await readEntitlements(workspaceId)).competitors;
  const blocked = await refusedBeforeFetch(workspaceId, cap, normalised);
  if (blocked !== null) return blocked;

  const target = await targetOf(raw, normalised);
  if ("message" in target) return target;
  const { domain, name } = target;

  if (await isTakenDown(domain)) return { message: "That brand asked not to be tracked, so we can't add it." };
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
