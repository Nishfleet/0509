import { insertAlternatePage } from "../data/page.server";
import { readEnabledSourceId } from "../data/source.server";
import { readAlternateAttempts, readBlockedRivals, recordAlternateAttempt } from "../data/watch.server";
import type { BlockedRival } from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import { readUrl } from "../fetch/transport.server";
import { takeBrowserEscalation } from "./browser-budget.server";
import { ownHostUrls } from "./alternate-sources";

const BLOCKED_RIVALS_PER_SWEEP = 3;
const RETRY_AFTER_MS = 3 * 86_400_000;

export const alternateHomeUrls = ownHostUrls;

type Attempt = { adopted: true; transport: "fetch" | "browser" } | { adopted: false; reason: string };

async function attempt(rival: BlockedRival, url: string, now: string): Promise<Attempt> {
  if (!(await robotsAllows(url))) return { adopted: false, reason: "robots" };
  const day = now.slice(0, 10);
  const read = await readUrl(url, {
    mayEscalate: () => takeBrowserEscalation(rival.workspaceId, rival.entityId, day),
  });
  if (!read.ok) return { adopted: false, reason: read.reason };
  return { adopted: true, transport: read.transport };
}

async function adoptFor(rival: BlockedRival, sourceId: string, now: string): Promise<boolean> {
  const since = new Date(Date.parse(now) - RETRY_AFTER_MS).toISOString();
  const tried = await readAlternateAttempts(rival.entityId, sourceId, since);
  for (const url of ownHostUrls(rival.domain)) {
    if (tried.has(url)) continue;
    const outcome = await attempt(rival, url, now);
    await recordAlternateAttempt({ entityId: rival.entityId, sourceId, url, at: now, outcome });
    if (!outcome.adopted) continue;
    await insertAlternatePage({
      entityId: rival.entityId,
      url,
      role: "blog",
      transport: outcome.transport,
      at: now,
    });
    return true;
  }
  return false;
}

export async function adoptAlternateHomes(now: string): Promise<number> {
  const sourceId = await readEnabledSourceId("site.web");
  if (sourceId === null) return 0;
  let adopted = 0;
  for (const rival of await readBlockedRivals(BLOCKED_RIVALS_PER_SWEEP)) {
    if (await adoptFor(rival, sourceId, now)) adopted += 1;
  }
  return adopted;
}
