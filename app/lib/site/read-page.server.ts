import { clearPageFailure, markPageDeferred, recordPageFailure, recordPageTransport } from "../data/page.server";
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

function failureText(read: { reason: string; detail: string }): string {
  return read.reason === "deferred" ? `deferred: ${read.detail}` : read.reason;
}

async function recordFailure(input: {
  target: SiteSweepTarget;
  live: { reason: string; detail: string };
  read: ReadUrlResult;
  now: string;
  options: ReadPageOptions;
}): Promise<void> {
  const { target, live, read, now, options } = input;
  await recordPageFailure(target.pageId, failureText(live), now);
  if (!read.ok && read.reason === "deferred" && options.browser !== false) await markPageDeferred(target.pageId, now);
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
  if (!live.ok) await recordFailure({ target, live, read, now, options });
  if (!read.ok || read.fromArchive === true) return read;
  await clearPageFailure(target.pageId);
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
