import { env } from "cloudflare:workers";

import { normaliseSubject } from "../identity/normalise";
import { planSiteSweep, uncoveredItems } from "./sweep.server";

const RECENT_HOURS = 20;

const onDomain = (url: string, domain: string): boolean => {
  const subject = normaliseSubject(url);
  return subject.ok && subject.subject.registrable === domain;
};

export async function enqueueFirstLook(workspaceId: string, now: string, domain?: string): Promise<number> {
  const since = new Date(Date.parse(now) - RECENT_HOURS * 3_600_000).toISOString();
  const mine = (await planSiteSweep(now)).filter(
    (target) => target.workspaceId === workspaceId && (domain === undefined || onDomain(target.url, domain)),
  );
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

export async function tryFirstLook(workspaceId: string, domain?: string): Promise<void> {
  try {
    await enqueueFirstLook(workspaceId, new Date().toISOString(), domain);
  } catch (error) {
    console.error(JSON.stringify({ event: "site.first_look_failed", error: String(error) }));
  }
}
