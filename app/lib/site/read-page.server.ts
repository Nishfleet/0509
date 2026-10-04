import { markPageDeferred, recordPageTransport } from "../data/page.server";
import type { SiteSweepTarget } from "../data/watch.server";
import { readOrArchive } from "../fetch/archive.server";
import type { ReadUrlResult } from "../fetch/transport.server";
import { readUrl } from "../fetch/transport.server";
import { takeBrowserEscalation } from "./browser-budget.server";

const RETEST_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReadPageOptions {
  browser?: boolean;
}

function escalation(
  options: ReadPageOptions,
  target: SiteSweepTarget,
  day: string,
): (() => Promise<boolean>) | undefined {
  if (options.browser === false) return undefined;
  return () => takeBrowserEscalation(target.workspaceId, target.entityId, day);
}

export async function readPage(
  target: SiteSweepTarget,
  now: string,
  options: ReadPageOptions = {},
): Promise<ReadUrlResult> {
  const learnedBrowser =
    target.transport === "browser" &&
    target.transportTestedAt !== null &&
    Date.parse(now) - Date.parse(target.transportTestedAt) < RETEST_MS;
  const day = now.slice(0, 10);
  const live = await readUrl(target.url, {
    startWith: learnedBrowser ? "browser" : "fetch",
    mayEscalate: escalation(options, target, day),
  });
  const read = await readOrArchive(live, {
    url: target.url,
    now: new Date(now),
    allowed: target.entityRole !== "self",
  });
  if (!read.ok) {
    if (read.reason === "deferred") await markPageDeferred(target.pageId, now);
    return read;
  }
  if (read.fromArchive === true) return read;
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
