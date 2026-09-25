import { env } from "cloudflare:workers";
import { z } from "zod";

import type { CardDraft, DraftField } from "./card-fields";
import { normaliseSubject } from "./normalise";
import { PROBE_TTL_SECONDS } from "./probe-cache.server";

const DRAFT_FIELD_MAX: Record<DraftField, number> = {
  name: 120,
  description: 500,
};

const DRAFT_SCHEMA = z.object({
  name: z.string().max(DRAFT_FIELD_MAX.name).optional(),
  description: z.string().max(DRAFT_FIELD_MAX.description).optional(),
});

export function draftKey(workspaceId: string, registrable: string): string {
  return `draft:${workspaceId}:${registrable}`;
}

export async function readDraft(workspaceId: string, registrable: string): Promise<CardDraft> {
  const raw = await env.IDENTITY_CACHE.get(draftKey(workspaceId, registrable), "json");
  if (raw === null) return {};
  const parsed = DRAFT_SCHEMA.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export async function saveDraftField(
  workspaceId: string,
  registrable: string,
  field: DraftField,
  value: string,
): Promise<void> {
  const current = await readDraft(workspaceId, registrable);
  const max = DRAFT_FIELD_MAX[field];
  const next: CardDraft = { ...current, [field]: value.slice(0, max) };
  await env.IDENTITY_CACHE.put(draftKey(workspaceId, registrable), JSON.stringify(next), {
    expirationTtl: PROBE_TTL_SECONDS,
  });
}

export async function clearDraftField(
  workspaceId: string,
  registrable: string,
  field: DraftField,
): Promise<void> {
  const current = await readDraft(workspaceId, registrable);
  const next: CardDraft = DRAFT_SCHEMA.parse(
    Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
  );
  if (Object.keys(next).length === 0) {
    await env.IDENTITY_CACHE.delete(draftKey(workspaceId, registrable));
    return;
  }
  await env.IDENTITY_CACHE.put(draftKey(workspaceId, registrable), JSON.stringify(next), {
    expirationTtl: PROBE_TTL_SECONDS,
  });
}

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
