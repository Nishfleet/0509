import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { insertPages, readEntitiesWithoutHomePage } from "../data/page.server";
import { insertSiteChange } from "../data/signal.server";
import { readEnabledSourceId } from "../data/source.server";
import type { SiteSweepTarget } from "../data/watch.server";
import {
  insertWatches,
  markWatchPolled,
  readSiteSweepTargets,
  readUnwatchedEntities,
} from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import type { CheckPageResult } from "./check-page.server";
import { checkPage } from "./check-page.server";
import { diffPageText } from "./diff";

const SITE_SOURCE_KEY = "site.web";

export type ChangedPage = Extract<CheckPageResult, { outcome: "changed" }>;

const WORDS = new Intl.Segmenter("en", { granularity: "word" });

function wordCount(value: string): number {
  return Array.from(WORDS.segment(value)).filter((segment) => segment.isWordLike).length;
}

async function readText(key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS.get(key);
  return object === null ? null : object.text();
}

function homeUrl(domain: string): string | null {
  return getDomain(domain) === domain ? `https://${domain}/` : null;
}

export async function ensureHomePages(now: string): Promise<void> {
  const entities = await readEntitiesWithoutHomePage();
  await insertPages(
    entities.flatMap((entity) => {
      const url = homeUrl(entity.domain);
      return url === null
        ? []
        : [{ id: crypto.randomUUID(), entityId: entity.id, url, role: "home" as const, discoveredAt: now }];
    }),
  );
}

export async function planSiteSweep(now: string): Promise<SiteSweepTarget[]> {
  await ensureHomePages(now);
  const sourceId = await readEnabledSourceId(SITE_SOURCE_KEY);
  if (sourceId === null) return [];

  const unwatched = await readUnwatchedEntities(sourceId);
  await insertWatches(
    unwatched.flatMap((entity) => {
      const url = homeUrl(entity.domain);
      return url === null
        ? []
        : [{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: url }];
    }),
  );
  return [...(await readSiteSweepTargets(SITE_SOURCE_KEY))];
}

export interface SweepTick {
  instanceId: string;
  plannedAt: string;
}

export async function checkSitePage(target: SiteSweepTarget, tick: SweepTick): Promise<CheckPageResult> {
  if (target.entityRole === "self" && !(await robotsAllows(target.url))) {
    console.log(JSON.stringify({ event: "site.check_failed", url: target.url, reason: "robots", detail: "disallowed by robots.txt" }));
    return { outcome: "failed", reason: "robots", detail: "disallowed by robots.txt" };
  }
  const result = await checkPage({
    watchId: target.watchId,
    pageId: target.pageId,
    url: target.url,
    snapshotId: `${tick.instanceId}-${target.pageId}`,
    before: tick.plannedAt,
  });
  if (result.outcome === "failed") {
    console.log(JSON.stringify({
      event: "site.check_failed",
      url: target.url,
      reason: result.reason,
      detail: result.detail,
    }));
    return result;
  }
  await markWatchPolled(target.watchId, new Date().toISOString());
  return result;
}

export async function publishSiteChange(target: SiteSweepTarget, changed: ChangedPage): Promise<string> {
  const [before, after] = await Promise.all([
    readText(changed.previousTextKey),
    readText(changed.textKey),
  ]);
  const diff =
    before === null || after === null
      ? null
      : diffPageText(
          { text: before, hash: changed.previousHash, charCount: before.length },
          { text: after, hash: changed.hash, charCount: after.length },
        );

  const diffKey = `snapshot/site/${target.watchId}/${changed.snapshotId}.diff.json`;
  if (diff !== null) {
    await env.SNAPSHOTS.put(diffKey, JSON.stringify({ hunks: diff.hunks }), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  const words = diff?.words ?? [];
  const payload = {
    page: { role: target.pageRole, url: target.url },
    before: {
      snapshotId: changed.previousSnapshotId,
      textKey: changed.previousTextKey,
      screenshotKey: changed.previousScreenshotKey,
    },
    after: {
      snapshotId: changed.snapshotId,
      textKey: changed.textKey,
      screenshotKey: changed.screenshotKey,
    },
    diffKey: diff === null ? null : diffKey,
    wordsAdded: words.filter((c) => c.added).reduce((n, c) => n + wordCount(c.value), 0),
    wordsRemoved: words.filter((c) => c.removed).reduce((n, c) => n + wordCount(c.value), 0),
    status: changed.status,
    transport: changed.transport,
  };

  await insertSiteChange({
    id: crypto.randomUUID(),
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    sourceId: target.sourceId,
    watchId: target.watchId,
    snapshotId: changed.snapshotId,
    aspect: target.pageRole,
    url: target.url,
    payloadJson: JSON.stringify(payload),
    observedAt: new Date().toISOString(),
  });
  return changed.snapshotId;
}
