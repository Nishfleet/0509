import { redirect } from "react-router";
import { z } from "zod";

import { forgetCompetitor } from "./competitor-forget.server";
import { saveCompetitorNote } from "./competitor-note.server";
import { saveCompetitorSite } from "./competitor-site.server";
import { saveCompetitorYoutube } from "./competitor-youtube.server";
import { handleCompetitorIntent } from "./competitors.server";

const FORGET_MISMATCH = "That doesn't match the name. Type it exactly as shown.";

export interface CompetitorFormErrors {
  forgetError: string | null;
  youtubeError: string | null;
  siteError: string | null;
  noteError: string | null;
}

const NO_ERRORS: CompetitorFormErrors = { forgetError: null, youtubeError: null, siteError: null, noteError: null };

const competitorForm = z.object({
  intent: z.string().default(""),
  confirm: z.string().default(""),
  youtube: z.string().default(""),
  site: z.string().default(""),
  note: z.string().default(""),
});

async function forget(workspaceId: string, entityId: string, confirm: string): Promise<CompetitorFormErrors> {
  const outcome = await forgetCompetitor(workspaceId, entityId, confirm);
  if (outcome === "forgotten") throw redirect("/app/competitors");
  if (outcome === "missing") throw new Response("We don't track that competitor.", { status: 404 });
  return { ...NO_ERRORS, forgetError: FORGET_MISMATCH };
}

async function saveDetail(
  workspaceId: string,
  entityId: string,
  fields: z.infer<typeof competitorForm>,
): Promise<Partial<CompetitorFormErrors> | null> {
  const error = (saved: { ok: true } | { ok: false; message: string }) => (saved.ok ? null : saved.message);
  if (fields.intent === "youtube") {
    return { youtubeError: error(await saveCompetitorYoutube(workspaceId, entityId, fields.youtube)) };
  }
  if (fields.intent === "note") {
    return { noteError: error(await saveCompetitorNote(workspaceId, entityId, fields.note)) };
  }
  if (fields.intent === "site") {
    return { siteError: error(await saveCompetitorSite(workspaceId, entityId, fields.site)) };
  }
  return null;
}

export async function handleCompetitorForm(
  workspaceId: string,
  entityId: string,
  form: FormData,
): Promise<CompetitorFormErrors & { message: string | null }> {
  const parsed = competitorForm.safeParse(Object.fromEntries(form));
  const fields = parsed.success ? parsed.data : { intent: "", confirm: "", youtube: "", site: "", note: "" };
  const { intent } = fields;
  if (intent === "forget") return { message: null, ...(await forget(workspaceId, entityId, fields.confirm)) };
  const saved = await saveDetail(workspaceId, entityId, fields);
  if (saved !== null) return { message: null, ...NO_ERRORS, ...saved };
  const toggle = new FormData();
  toggle.set("intent", intent === "on" || intent === "off" ? intent : "");
  toggle.set("entityId", entityId);
  return { ...NO_ERRORS, ...(await handleCompetitorIntent(workspaceId, toggle)) };
}
