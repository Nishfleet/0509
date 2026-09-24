import { env } from "cloudflare:workers";

import type { AccountDeleteParams } from "./account-delete.server";
import { setCompetitorState } from "./data/entity.server";
import { deleteEntitySignals } from "./data/signal.server";
import { deleteEntitySnapshots } from "./data/snapshot.server";
import { readEntityR2Prefixes } from "./data/watch.server";

export async function forgetCompetitor(
  workspaceId: string,
  entityId: string,
  now: string,
): Promise<boolean> {
  const prefixes = await readEntityR2Prefixes(workspaceId, entityId);
  const flipped = await setCompetitorState(workspaceId, entityId, "off", now);
  if (!flipped && prefixes.length === 0) return false;
  await env.DB.batch([deleteEntitySignals(workspaceId, entityId), deleteEntitySnapshots(workspaceId, entityId)]);
  if (prefixes.length > 0) {
    await env.ACCOUNT_DELETE.create({ params: { prefixes } satisfies AccountDeleteParams });
  }
  return true;
}
