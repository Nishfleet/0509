import { redirect } from "react-router";
import { z } from "zod";

import { forgetCompetitor } from "./competitor-forget.server";
import { saveCompetitorName } from "./competitor-name.server";
import { saveCompetitorSite } from "./competitor-site.server";
import { saveCompetitorYoutube } from "./competitor-youtube.server";
import { handleCompetitorIntent } from "./competitors.server";

const FORGET_MISMATCH = "That doesn't match the name. Type it exactly as shown.";

export interface CompetitorFormErrors {
  forgetError: string | null;
  youtubeError: string | null;
  siteError: string | null;
  nameError: string | null;
  renamed: boolean;
}

const NO_ERRORS: CompetitorFormErrors = {
  forgetError: null,
  youtubeError: null,
  siteError: null,
  nameError: null,
  renamed: false,
};

const competitorForm = z.object({
  intent: z.string().default(""),
  confirm: z.string().default(""),
  youtube: z.string().default(""),
  site: z.string().default(""),
  name: z.string().default(""),
});

async function forget(workspaceId: string, entityId: string, confirm: string): Promise<CompetitorFormErrors> {
  const outcome = await forgetCompetitor(workspaceId, entityId, confirm);
  if (outcome === "forgotten") throw redirect("/app/competitors");
  if (outcome === "missing") throw new Response("We don't track that competitor.", { status: 404 });
  return { ...NO_ERRORS, forgetError: FORGET_MISMATCH };
}

type FormResult = CompetitorFormErrors & { message: string | null };
type Fields = z.infer<typeof competitorForm>;

async function editField(workspaceId: string, entityId: string, fields: Fields): Promise<FormResult | null> {
  if (fields.intent === "rename") {
    const saved = await saveCompetitorName(workspaceId, entityId, fields.name);
    return { message: null, ...NO_ERRORS, nameError: saved.ok ? null : saved.message, renamed: saved.ok };
  }
  if (fields.intent === "youtube") {
    const saved = await saveCompetitorYoutube(workspaceId, entityId, fields.youtube);
    return { message: null, ...NO_ERRORS, youtubeError: saved.ok ? null : saved.message };
  }
  if (fields.intent === "site") {
    const saved = await saveCompetitorSite(workspaceId, entityId, fields.site);
    return { message: null, ...NO_ERRORS, siteError: saved.ok ? null : saved.message };
  }
  return null;
}

export async function handleCompetitorForm(workspaceId: string, entityId: string, form: FormData): Promise<FormResult> {
  const parsed = competitorForm.safeParse(Object.fromEntries(form));
  const fields = parsed.success ? parsed.data : { intent: "", confirm: "", youtube: "", site: "", name: "" };
  const { intent } = fields;
  if (intent === "forget") return { message: null, ...(await forget(workspaceId, entityId, fields.confirm)) };
  const edited = await editField(workspaceId, entityId, fields);
  if (edited !== null) return edited;
  const toggle = new FormData();
  toggle.set("intent", intent === "on" || intent === "off" ? intent : "");
  toggle.set("entityId", entityId);
  return { ...NO_ERRORS, ...(await handleCompetitorIntent(workspaceId, toggle)) };
}
