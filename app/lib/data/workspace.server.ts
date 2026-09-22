import { env } from "cloudflare:workers";

import { replaceRollover, type RolloverBinding } from "../standing-schedule.server";
import { briefError } from "../standing-score";

interface CardRow {
  card_slug: string | null;
  card_is_published: 0 | 1;
}

const SELECT_CARD = "SELECT card_slug, card_is_published FROM workspace WHERE id = ?";

const SELECT_WORKSPACE_BY_OWNER = `SELECT id FROM workspace WHERE owner_user_id = ?
ORDER BY created_at LIMIT 1`;

const CLAIM_CARD = `UPDATE workspace
SET card_is_published = 1,
    card_slug = CASE WHEN card_slug IS NULL THEN ? ELSE card_slug END
WHERE id = ? AND card_is_published = 0`;

const UNPUBLISH_CARD = "UPDATE workspace SET card_is_published = 0 WHERE id = ?";

const ROTATE_CARD_SLUG = `UPDATE workspace SET card_slug = ?
WHERE id = ? AND card_is_published = 1`;

const CARD_SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function newCardSlug(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36];
  return out;
}

export interface CardSettings {
  published: boolean;
  slug: string | null;
}

export async function readCardSettings(workspaceId: string): Promise<CardSettings | null> {
  const row = await env.DB.prepare(SELECT_CARD).bind(workspaceId).first<CardRow>();
  if (row === null) return null;
  return { published: row.card_is_published === 1, slug: row.card_slug };
}

export async function publishCard(workspaceId: string): Promise<CardSettings | null> {
  for (let attempt = 0; attempt < CARD_SLUG_ATTEMPTS; attempt += 1) {
    const existing = await readCardSettings(workspaceId);
    if (existing === null) return null;
    if (existing.published) return existing;

    try {
      await env.DB.prepare(CLAIM_CARD).bind(newCardSlug(), workspaceId).run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }
    return readCardSettings(workspaceId);
  }
  throw new Error("could not claim a unique card slug");
}

export async function unpublishCard(workspaceId: string): Promise<void> {
  await env.DB.prepare(UNPUBLISH_CARD).bind(workspaceId).run();
}

export async function rotateCardSlug(workspaceId: string): Promise<string | null> {
  for (let attempt = 0; attempt < CARD_SLUG_ATTEMPTS; attempt += 1) {
    const slug = newCardSlug();
    try {
      await env.DB.prepare(ROTATE_CARD_SLUG).bind(slug, workspaceId).run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }
    return slug;
  }
  return null;
}

export async function saveBrief(
  userId: string,
  input: { timezone: string; weekday: number; hour: number },
): Promise<{ error: string | null; nextBrief: string | null }> {
  const error = briefError(input.timezone, input.weekday, input.hour);
  if (error) return { error, nextBrief: null };
  const workspace = await env.DB.prepare(
    `SELECT id, standing_instance_id FROM workspace
     WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string; standing_instance_id: string | null }>();
  if (!workspace) return { error: "No workspace yet.", nextBrief: null };
  await env.DB.prepare(
    "UPDATE workspace SET timezone = ?, brief_weekday = ?, brief_hour = ? WHERE id = ?",
  )
    .bind(input.timezone, input.weekday, input.hour, workspace.id)
    .run();
  const now = new Date();
  const binding: RolloverBinding = env.STANDING_ROLLOVER;
  await replaceRollover(
    binding,
    env.DB,
    {
      id: workspace.id,
      timezone: input.timezone,
      briefWeekday: input.weekday,
      briefHour: input.hour,
    },
    workspace.standing_instance_id,
    now,
  );
  const stored = await env.DB.prepare("SELECT next_brief_at FROM workspace WHERE id = ?")
    .bind(workspace.id)
    .first<{ next_brief_at: string | null }>();
  return { error: null, nextBrief: stored?.next_brief_at ?? null };
}

export async function loadBrief(userId: string): Promise<{
  timezone: string;
  weekday: number;
  hour: number;
  nextBrief: string | null;
} | null> {
  const workspace = await env.DB.prepare(
    `SELECT timezone, brief_weekday, brief_hour, next_brief_at
     FROM workspace WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`,
  )
    .bind(userId)
    .first<{
      timezone: string;
      brief_weekday: number;
      brief_hour: number;
      next_brief_at: string | null;
    }>();
  if (!workspace) return null;
  return {
    timezone: workspace.timezone,
    weekday: workspace.brief_weekday,
    hour: workspace.brief_hour,
    nextBrief: workspace.next_brief_at,
  };
}

export async function readWorkspaceIdForOwner(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(SELECT_WORKSPACE_BY_OWNER).bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}
