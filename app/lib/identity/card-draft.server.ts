import { env } from "cloudflare:workers";
import { z } from "zod";

import type { CardDraft, DraftField } from "./card-fields";
import { PROBE_TTL_SECONDS } from "./probe-cache.server";

export type { CardDraft, DraftField };

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
