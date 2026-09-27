import { markPageDeferred, recordPageTransport } from "../data/page.server";
import type { SiteSweepTarget } from "../data/watch.server";
import type { ReadUrlResult } from "../fetch/transport.server";
import { readUrl } from "../fetch/transport.server";
import { takeBrowserEscalation } from "./browser-budget.server";

const RETEST_MS = 7 * 24 * 60 * 60 * 1000;

export async function readPage(target: SiteSweepTarget, now: string): Promise<ReadUrlResult> {
  const learnedBrowser =
    target.transport === "browser" &&
    target.transportTestedAt !== null &&
    Date.parse(now) - Date.parse(target.transportTestedAt) < RETEST_MS;
  const day = now.slice(0, 10);
  const read = await readUrl(target.url, {
    startWith: learnedBrowser ? "browser" : "fetch",
    mayEscalate: () => takeBrowserEscalation(target.workspaceId, target.entityId, day),
  });
  if (!read.ok) {
    if (read.reason === "deferred") await markPageDeferred(target.pageId, now);
    return read;
  }
  if (!learnedBrowser) {
    await recordPageTransport({
      pageId: target.pageId,
      transport: read.transport,
      reason: read.escalationReason ?? null,
      testedAt: now,
    });
  }
  return read;
}
