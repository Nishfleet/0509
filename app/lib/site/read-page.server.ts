import { markPageDeferred, recordPageTransport } from "../data/page.server";
import type { SiteSweepTarget } from "../data/watch.server";
import { readOrArchive } from "../fetch/archive.server";
import type { ReadUrlResult } from "../fetch/transport.server";
import { keepSharedPage, readSharedPage, type SharedReadKey } from "../fetch/shared-read.server";
import { sharedChecksOn } from "../shared-checks.server";
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

async function rememberTransport(
  target: SiteSweepTarget,
  read: Extract<ReadUrlResult, { ok: true }>,
  now: string,
): Promise<void> {
  await recordPageTransport({
    pageId: target.pageId,
    transport: read.transport,
    reason: read.escalationReason ?? null,
    testedAt: now,
  });
}

function learnedBrowser(target: SiteSweepTarget, now: string): boolean {
  return (
    target.transport === "browser" &&
    target.transportTestedAt !== null &&
    Date.parse(now) - Date.parse(target.transportTestedAt) < RETEST_MS
  );
}

function startMode(target: SiteSweepTarget, now: string): "fetch" | "browser" {
  return learnedBrowser(target, now) ? "browser" : "fetch";
}

async function readLive(target: SiteSweepTarget, now: string, options: ReadPageOptions): Promise<ReadUrlResult> {
  const live = await readUrl(target.url, {
    startWith: startMode(target, now),
    mayEscalate: escalation(options, target, now.slice(0, 10)),
  });
  return readOrArchive(live, { url: target.url, now: new Date(now), allowed: target.entityRole !== "self" });
}

function sharedKey(target: SiteSweepTarget, now: string): SharedReadKey {
  return { url: target.url, sweep: now, startWith: startMode(target, now) };
}

async function keepSharedPageSafely(key: SharedReadKey, read: Extract<ReadUrlResult, { ok: true }>): Promise<void> {
  if (read.transport !== key.startWith) return;
  try {
    await keepSharedPage(key, read);
  } catch (error) {
    console.error(JSON.stringify({ event: "site.shared_read_keep_failed", error: String(error) }));
  }
}

async function rememberUnlessLearned(
  target: SiteSweepTarget,
  read: Extract<ReadUrlResult, { ok: true }>,
  now: string,
): Promise<void> {
  if (!learnedBrowser(target, now)) await rememberTransport(target, read, now);
}

export async function readPage(
  target: SiteSweepTarget,
  now: string,
  options: ReadPageOptions = {},
): Promise<ReadUrlResult> {
  const isRival = target.entityRole !== "self" && sharedChecksOn();
  const key = sharedKey(target, now);
  const shared = isRival ? await readSharedPage(key) : null;
  if (shared !== null) {
    await rememberUnlessLearned(target, shared, now);
    return shared;
  }
  const read = await readLive(target, now, options);
  if (!read.ok) {
    if (read.reason === "deferred") await markPageDeferred(target.pageId, now);
    return read;
  }
  if (read.fromArchive === true) return read;
  if (isRival) await keepSharedPageSafely(key, read);
  await rememberUnlessLearned(target, read, now);
  return read;
}
