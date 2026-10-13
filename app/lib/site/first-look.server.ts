import { env } from "cloudflare:workers";

import { planSiteSweep, uncoveredItems } from "./sweep.server";

const RECENT_HOURS = 20;

export async function enqueueFirstLook(workspaceId: string, now: string): Promise<number> {
  const since = new Date(Date.parse(now) - RECENT_HOURS * 3_600_000).toISOString();
  const mine = (await planSiteSweep(now)).filter((target) => target.workspaceId === workspaceId);
  const unread = await uncoveredItems(mine, since);
  if (unread.length === 0) return 0;
  await env.FETCH_SWEEP.sendBatch(
    unread.map((target) => ({
      body: {
        watchId: target.watchId,
        entityId: target.entityId,
        sourceId: target.sourceId,
        targetKey: target.url,
      },
    })),
  );
  return unread.length;
}

export async function tryFirstLook(workspaceId: string): Promise<void> {
  try {
    await enqueueFirstLook(workspaceId, new Date().toISOString());
  } catch (error) {
    console.error(JSON.stringify({ event: "site.first_look_failed", error: String(error) }));
  }
}
