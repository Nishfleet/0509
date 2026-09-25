import { env } from "cloudflare:workers";

import type { AccountDeleteParams } from "./account-delete.server";
import { deleteCompetitor, readCompetitor } from "./data/entity.server";
import { dismissForgottenCompetitor } from "./data/suggestion.server";
import { readEntityR2Prefixes } from "./data/watch.server";

type ForgetOutcome = "forgotten" | "mismatch" | "missing";

export async function forgetCompetitor(
  workspaceId: string,
  entityId: string,
  typedName: string,
): Promise<ForgetOutcome> {
  const competitor = await readCompetitor(workspaceId, entityId);
  if (competitor === null) return "missing";
  if (typedName.trim().toLowerCase() !== competitor.name.trim().toLowerCase()) return "mismatch";
  const prefixes = await readEntityR2Prefixes(workspaceId, entityId);
  await env.DB.batch([
    dismissForgottenCompetitor({ workspaceId, entityId, now: new Date().toISOString() }),
    deleteCompetitor(workspaceId, entityId),
  ]);
  if (prefixes.length > 0) {
    await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  }
  return "forgotten";
}
