import { redirect } from "react-router";
import { z } from "zod";

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

const competitorForm = z.object({
  intent: z.string().default(""),
  confirm: z.string().default(""),
  youtube: z.string().default(""),
  site: z.string().default(""),
});

async function forget(workspaceId: string, entityId: string, confirm: string): Promise<CompetitorFormErrors> {
  const outcome = await forgetCompetitor(workspaceId, entityId, confirm);
  if (outcome === "forgotten") throw redirect("/app/competitors");
  if (outcome === "missing") throw new Response("We don't track that competitor.", { status: 404 });
  return { ...NO_ERRORS, forgetError: FORGET_MISMATCH };
}

export async function handleCompetitorForm(
  workspaceId: string,
  entityId: string,
  form: FormData,
): Promise<CompetitorFormErrors & { message: string | null }> {
  const parsed = competitorForm.safeParse(Object.fromEntries(form));
  const fields = parsed.success ? parsed.data : { intent: "", confirm: "", youtube: "", site: "" };
  const { intent } = fields;
  if (intent === "forget") return { message: null, ...(await forget(workspaceId, entityId, fields.confirm)) };
  if (intent === "youtube") {
    const saved = await saveCompetitorYoutube(workspaceId, entityId, fields.youtube);
    return { message: null, ...NO_ERRORS, youtubeError: saved.ok ? null : saved.message };
  }
  if (intent === "site") {
    const saved = await saveCompetitorSite(workspaceId, entityId, fields.site);
    return { message: null, ...NO_ERRORS, siteError: saved.ok ? null : saved.message };
  }
  const toggle = new FormData();
  toggle.set("intent", intent === "on" || intent === "off" ? intent : "");
  toggle.set("entityId", entityId);
  return { ...NO_ERRORS, ...(await handleCompetitorIntent(workspaceId, toggle)) };
}
