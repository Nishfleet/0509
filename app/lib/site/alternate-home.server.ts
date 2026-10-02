import { readBlockedRivals, readRecentAlternateAttempts, recordAlternateAttempt } from "../data/page.server";
import type { BlockedRival } from "../data/page.server";
import { readEnabledSourceId } from "../data/source.server";
import { insertWatches } from "../data/watch.server";
import { readUrl } from "../fetch/transport.server";
import { robotsAllows } from "../fetch/robots.server";
import { takeBrowserEscalation } from "./browser-budget.server";

const ALTERNATE_LABELS = ["news", "newsroom", "press"] as const;
const BLOCKED_RIVALS_PER_SWEEP = 3;
const RETRY_AFTER_MS = 3 * 86_400_000;

export function alternateHomeUrls(domain: string): string[] {
  return ALTERNATE_LABELS.map((label) => `https://${label}.${domain}/`);
}

async function tryAlternate(rival: BlockedRival, url: string, now: string): Promise<boolean> {
  if (!(await robotsAllows(url))) {
    await recordAlternateAttempt({
      entityId: rival.entityId,
      url,
      at: now,
      outcome: { adopted: false, reason: "robots" },
    });
    return false;
  }
  const day = now.slice(0, 10);
  const read = await readUrl(url, {
    mayEscalate: () => takeBrowserEscalation(rival.workspaceId, rival.entityId, day),
  });
  if (!read.ok) {
    await recordAlternateAttempt({
      entityId: rival.entityId,
      url,
      at: now,
      outcome: { adopted: false, reason: read.reason },
    });
    return false;
  }
  await recordAlternateAttempt({
    entityId: rival.entityId,
    url,
    at: now,
    outcome: { adopted: true, transport: read.transport },
  });
  return true;
}

async function adoptFor(rival: BlockedRival, siteSourceId: string, now: string): Promise<boolean> {
  const since = new Date(Date.parse(now) - RETRY_AFTER_MS).toISOString();
  const tried = await readRecentAlternateAttempts(rival.entityId, since);
  for (const url of alternateHomeUrls(rival.domain)) {
    if (tried.has(url) || !(await tryAlternate(rival, url, now))) continue;
    await insertWatches([
      { id: crypto.randomUUID(), entityId: rival.entityId, sourceId: siteSourceId, targetKey: url },
    ]);
    return true;
  }
  return false;
}

export async function adoptAlternateHomes(now: string): Promise<number> {
  const siteSourceId = await readEnabledSourceId("site.web");
  if (siteSourceId === null) return 0;
  let adopted = 0;
  for (const rival of await readBlockedRivals(BLOCKED_RIVALS_PER_SWEEP)) {
    if (await adoptFor(rival, siteSourceId, now)) adopted += 1;
  }
  return adopted;
}
