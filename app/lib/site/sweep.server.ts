import { env } from "cloudflare:workers";
import { getDomain } from "tldts";
import { z } from "zod";

import { insertPages, readEntitiesWithoutHomePage } from "../data/page.server";
import { insertSiteChange } from "../data/signal.server";
import { readEnabledSourceId } from "../data/source.server";
import {
  insertWatches,
  markWatchPolled,
  readUnwatchedEntities,
} from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import { computeBreakageEvidence } from "./breakage-evidence";
import type { CheckPageResult } from "./check-page.server";
import { checkPage } from "./check-page.server";
import type { PageDiff } from "./diff";
import { diffPageText } from "./diff";
import type { ChangeJudgment } from "./judge.server";

const SITE_SOURCE_KEY = "site.web";

export const CHUNK_SIZE = 10;

export const PAGES_PER_COMPETITOR = 4;

export type SweepScope = "competitors" | "self";

export type SweepOutcome =
  | "failed"
  | "first"
  | "unchanged"
  | "published"
  | "quiet"
  | "deferred";

export interface SweepItem {
  watchId: string;
  pageId: string;
  url: string;
  pageRole: string | null;
  entityId: string;
  workspaceId: string;
  sourceId: string;
  entityName: string | null;
  domain: string;
  isSelf: boolean;
}

export interface SweepTick {
  instanceId: string;
  plannedAt: string;
}

type ChangedPage = Extract<CheckPageResult, { outcome: "changed" }>;

const WORDS = new Intl.Segmenter("en", { granularity: "word" });

const SITE_ITEMS = `SELECT w.id AS watch_id,
       p.id AS page_id,
       p.url AS url,
       p.role AS page_role,
       e.id AS entity_id,
       e.workspace_id AS workspace_id,
       w.source_id AS source_id,
       e.name AS entity_name,
       e.domain AS domain,
       e.role AS entity_role
FROM watch w
JOIN source s ON s.id = w.source_id
JOIN entity e ON e.id = w.entity_id
JOIN page p ON p.entity_id = e.id AND p.url = w.target_key
WHERE w.is_active = 1
  AND s.is_enabled = 1
  AND s.kind = 'site'
  AND e.state = 'on'
  AND e.role = ?1
ORDER BY e.workspace_id, e.id, p.url`;

const COVERED = `SELECT COUNT(DISTINCT w.id) AS covered
FROM watch w
JOIN source s ON s.id = w.source_id
JOIN entity e ON e.id = w.entity_id
JOIN page p ON p.entity_id = e.id AND p.url = w.target_key
JOIN snapshot sn ON sn.watch_id = w.id AND sn.page_id = p.id AND sn.fetched_at >= ?2
WHERE w.is_active = 1
  AND s.is_enabled = 1
  AND s.kind = 'site'
  AND e.state = 'on'
  AND e.role = ?1
  AND (?1 = 'competitor' OR p.role IN ('home', 'pricing'))`;

const siteItemRows = z.array(
  z.object({
    watch_id: z.string(),
    page_id: z.string(),
    url: z.string(),
    page_role: z.string().nullable(),
    entity_id: z.string(),
    workspace_id: z.string(),
    source_id: z.string(),
    entity_name: z.string().nullable(),
    domain: z.string(),
    entity_role: z.string(),
  }),
);

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

function toSweepItem(row: z.output<typeof siteItemRows>[number]): SweepItem {
  return {
    watchId: row.watch_id,
    pageId: row.page_id,
    url: row.url,
    pageRole: row.page_role,
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    sourceId: row.source_id,
    entityName: row.entity_name,
    domain: row.domain,
    isSelf: row.entity_role === "self",
  };
}

function roleRank(role: string | null): number {
  if (role === "home") return 0;
  if (role === "pricing") return 1;
  return 2;
}

function byPriority(a: SweepItem, b: SweepItem): number {
  const rank = roleRank(a.pageRole) - roleRank(b.pageRole);
  if (rank !== 0) return rank;
  if (a.url === b.url) return 0;
  return a.url < b.url ? -1 : 1;
}

function selfItems(items: readonly SweepItem[]): SweepItem[] {
  return items
    .filter((item) => item.pageRole === "home" || item.pageRole === "pricing")
    .sort(byPriority);
}

function competitorItems(items: readonly SweepItem[]): SweepItem[] {
  const grouped = items.reduce<ReadonlyMap<string, SweepItem[]>>((groups, item) => {
    const existing = groups.get(item.entityId) ?? [];
    return new Map(groups).set(item.entityId, [...existing, item]);
  }, new Map());
  return [...grouped.values()].flatMap((group) =>
    [...group].sort(byPriority).slice(0, PAGES_PER_COMPETITOR),
  );
}

export async function planSweep(scope: SweepScope): Promise<SweepItem[]> {
  await ensureHomePages(new Date().toISOString());
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

  const rows = await env.DB.prepare(SITE_ITEMS)
    .bind(scope === "self" ? "self" : "competitor")
    .all();
  const items = [...siteItemRows.parse(rows.results)].map(toSweepItem);
  return scope === "self" ? selfItems(items) : competitorItems(items);
}

export async function countCovered(scope: SweepScope, sinceIso: string): Promise<number> {
  const row = await env.DB.prepare(COVERED)
    .bind(scope === "self" ? "self" : "competitor", sinceIso)
    .first<{ covered: number }>();
  return row?.covered ?? 0;
}

function publishedBand(judgment: ChangeJudgment): boolean {
  const breakage = judgment.selfBreakage;
  if (breakage !== null && (breakage.band === "alert" || breakage.band === "check")) return true;
  const noteworthy = judgment.noteworthy;
  return noteworthy !== null && (noteworthy.band === "publish" || noteworthy.band === "uncertain");
}

async function writeSiteChange(item: SweepItem, changed: ChangedPage, diff: PageDiff): Promise<string> {
  const diffKey = `snapshot/site/${item.watchId}/${changed.snapshotId}.diff.json`;
  await env.SNAPSHOTS.put(diffKey, JSON.stringify({ hunks: diff.hunks }), {
    httpMetadata: { contentType: "application/json" },
  });

  const words = diff.words;
  const payload = {
    page: { role: item.pageRole, url: item.url },
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
    diffKey,
    wordsAdded: words.filter((change) => change.added).reduce((n, change) => n + wordCount(change.value), 0),
    wordsRemoved: words.filter((change) => change.removed).reduce((n, change) => n + wordCount(change.value), 0),
    status: changed.status,
    transport: changed.transport,
  };

  await insertSiteChange({
    id: crypto.randomUUID(),
    workspaceId: item.workspaceId,
    entityId: item.entityId,
    sourceId: item.sourceId,
    watchId: item.watchId,
    snapshotId: changed.snapshotId,
    aspect: item.pageRole ?? "other",
    url: item.url,
    payloadJson: JSON.stringify(payload),
    observedAt: new Date().toISOString(),
  });
  return changed.snapshotId;
}

export async function sweepItem(item: SweepItem, tick: SweepTick): Promise<SweepOutcome> {
  if (item.isSelf && !(await robotsAllows(item.url))) {
    console.log(JSON.stringify({
      event: "site.check_failed",
      url: item.url,
      reason: "robots",
      detail: "disallowed by robots.txt",
    }));
    return "failed";
  }

  const checked = await checkPage({
    watchId: item.watchId,
    pageId: item.pageId,
    url: item.url,
    snapshotId: `${tick.instanceId}-${item.pageId}`,
    before: tick.plannedAt,
  });
  if (checked.outcome === "failed") {
    console.log(JSON.stringify({
      event: "site.check_failed",
      url: item.url,
      reason: checked.reason,
      detail: checked.detail,
    }));
    return "failed";
  }
  await markWatchPolled(item.watchId, new Date().toISOString());
  if (checked.outcome !== "changed") return checked.outcome;

  const [before, after] = await Promise.all([
    readText(checked.previousTextKey),
    readText(checked.textKey),
  ]);
  if (before === null || after === null) return "failed";

  const diff = diffPageText(
    { text: before, hash: checked.previousHash, charCount: before.length },
    { text: after, hash: checked.hash, charCount: after.length },
  );
  if (diff === null) return "unchanged";

  const { judgeChange } = await import("./judge.server");
  const judgment = await judgeChange({
    workspaceId: item.workspaceId,
    entityId: item.entityId,
    isSelf: item.isSelf,
    subject: { name: item.entityName, domain: item.domain },
    pageUrl: item.url,
    pageRole: item.pageRole,
    hunks: diff.hunks,
    evidence: computeBreakageEvidence({
      status: checked.status,
      beforeText: before,
      afterText: after,
    }),
  });
  if (judgment.deferred) return "deferred";

  await writeSiteChange(item, checked, diff);
  return publishedBand(judgment) ? "published" : "quiet";
}
