import { redirect } from "react-router";

import { forgetCompetitor } from "./competitor-forget.server";
import { saveCompetitorSite } from "./competitor-site.server";
import { saveCompetitorYoutube } from "./competitor-youtube.server";
import { handleCompetitorIntent } from "./competitors.server";

const FORGET_MISMATCH = "That doesn't match the name. Type it exactly as shown.";

export interface CompetitorFormErrors {
  forgetError: string | null;
  youtubeError: string | null;
  siteError: string | null;
}

const NO_ERRORS: CompetitorFormErrors = { forgetError: null, youtubeError: null, siteError: null };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function forget(workspaceId: string, entityId: string, form: FormData): Promise<CompetitorFormErrors> {
  const outcome = await forgetCompetitor(workspaceId, entityId, field(form, "confirm"));
  if (outcome === "forgotten") throw redirect("/app/competitors");
  if (outcome === "missing") throw new Response("We don't track that competitor.", { status: 404 });
  return { ...NO_ERRORS, forgetError: FORGET_MISMATCH };
}

export async function handleCompetitorForm(
  workspaceId: string,
  entityId: string,
  form: FormData,
): Promise<CompetitorFormErrors & { message: string | null }> {
  const intent = field(form, "intent");
  if (intent === "forget") return { message: null, ...(await forget(workspaceId, entityId, form)) };
  if (intent === "youtube") {
    const saved = await saveCompetitorYoutube(workspaceId, entityId, field(form, "youtube"));
    return { message: null, ...NO_ERRORS, youtubeError: saved.ok ? null : saved.message };
  }
  if (intent === "site") {
    const saved = await saveCompetitorSite(workspaceId, entityId, field(form, "site"));
    return { message: null, ...NO_ERRORS, siteError: saved.ok ? null : saved.message };
  }
  const toggle = new FormData();
  toggle.set("intent", intent === "on" || intent === "off" ? intent : "");
  toggle.set("entityId", entityId);
  return { ...NO_ERRORS, ...(await handleCompetitorIntent(workspaceId, toggle)) };
}
