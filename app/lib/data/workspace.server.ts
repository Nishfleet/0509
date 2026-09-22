import { env } from "cloudflare:workers";

import { replaceRollover } from "../../../workers/standing/schedule";
import { briefError, nextRolloverInstant } from "../../../workers/standing/score";

export async function saveBrief(
  userId: string,
  input: { timezone: string; weekday: number; hour: number },
): Promise<{ error: string | null; nextBrief: string | null }> {
  const error = briefError(input.timezone, input.weekday, input.hour);
  if (error) return { error, nextBrief: null };
  const workspace = await env.DB.prepare(
    `SELECT id, standing_instance_id FROM workspace
     WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`,
  ).bind(userId).first<{ id: string; standing_instance_id: string | null }>();
  if (!workspace) return { error: "No workspace yet.", nextBrief: null };
  await env.DB.prepare(
    "UPDATE workspace SET timezone = ?, brief_weekday = ?, brief_hour = ? WHERE id = ?",
  ).bind(input.timezone, input.weekday, input.hour, workspace.id).run();
  const now = new Date();
  await replaceRollover(
    env.STANDING_ROLLOVER,
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
  return {
    error: null,
    nextBrief: nextRolloverInstant(now, input.timezone, input.weekday, input.hour),
  };
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
  ).bind(userId).first<{
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
