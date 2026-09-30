import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { insertPages, readEntitiesWithoutHomePage } from "../data/page.server";
import { linkVerdictsStatement } from "../data/jev_verdict.server";
import { insertChangeSignalStatement } from "../data/signal.server";
import { readCoveredPagePairs } from "../data/snapshot.server";
import { readEnabledSourceId } from "../data/source.server";
import type { SiteSweepTarget } from "../data/watch.server";
import { insertWatches, markWatchPolled, readSiteSweepTargets, readUnwatchedEntities } from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import { normaliseSubject } from "../identity/normalise";
import { takeBrowserScreenshot } from "./browser-budget.server";
import { computeBreakageEvidence } from "./breakage-evidence";
import type { CheckPageResult } from "./check-page.server";
import { checkPage } from "./check-page.server";
import { diffPageText } from "./diff";
import type { JudgedChange, JudgeInput } from "./judge.server";
import { judgeChange } from "./judge.server";
import { readPage } from "./read-page.server";

const SITE_SOURCE_KEY = "site.web";

export const CHUNK_SIZE = 10;

export type ChangedPage = Extract<CheckPageResult, { outcome: "changed" }>;

const WORDS = new Intl.Segmenter("en", { granularity: "word" });

function wordCount(value: string): number {
  return Array.from(WORDS.segment(value)).filter((segment) => segment.isWordLike).length;
}

async function readText(key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS.get(key);
  return object === null ? null : object.text();
}

function enteredHomeUrl(entity: { domain: string; url: string | null }): string | null {
  if (entity.url === null) return null;
  const entered = normaliseSubject(entity.url);
  if (
    !entered.ok ||
    entered.subject.kind !== "domain" ||
    entered.subject.registrable !== entity.domain ||
    entered.subject.url === null
  ) {
    return null;
  }
  return entered.subject.url;
}

function homeUrl(entity: { domain: string; url: string | null }): string | null {
  const entered = enteredHomeUrl(entity);
  if (entered !== null) return entered;
  return getDomain(entity.domain) === entity.domain ? `https://${entity.domain}/` : null;
}

export async function ensureHomePages(now: string): Promise<void> {
  const entities = await readEntitiesWithoutHomePage();
  await insertPages(
    entities.flatMap((entity) => {
      const url = homeUrl(entity);
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
      const url = homeUrl(entity);
      return url === null ? [] : [{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: url }];
    }),
  );
  return [...(await readSiteSweepTargets(SITE_SOURCE_KEY))];
}

export async function uncoveredItems(items: readonly SiteSweepTarget[], sinceIso: string): Promise<SiteSweepTarget[]> {
  if (items.length === 0) return [];
  const covered = new Set(
    (
      await readCoveredPagePairs(
        sinceIso,
        items.map((item) => item.watchId),
      )
    ).map((row) => `${row.watchId}|${row.pageId}`),
  );
  return items.filter((item) => !covered.has(`${item.watchId}|${item.pageId}`));
}

export interface SweepTick {
  instanceId: string;
  plannedAt: string;
}

export interface CheckSitePageOptions {
  browser?: boolean;
}

export async function checkSitePage(
  target: SiteSweepTarget,
  tick: SweepTick,
  options: CheckSitePageOptions = {},
): Promise<CheckPageResult> {
  if (target.entityRole === "self" && !(await robotsAllows(target.url))) {
    console.log(
      JSON.stringify({
        event: "site.check_failed",
        url: target.url,
        reason: "robots",
        detail: "disallowed by robots.txt",
      }),
    );
    return { outcome: "failed", reason: "robots", detail: "disallowed by robots.txt" };
  }
  const read = await readPage(target, tick.plannedAt, { browser: options.browser ?? true });
  const result = await checkPage({
    watchId: target.watchId,
    pageId: target.pageId,
    url: target.url,
    snapshotId: `${tick.instanceId}-${target.pageId}`,
    before: tick.plannedAt,
    read,
    mayScreenshot:
      options.browser === false
        ? undefined
        : () => takeBrowserScreenshot(target.workspaceId, target.entityId, tick.plannedAt.slice(0, 10)),
  });
  if (result.outcome === "failed") {
    console.log(
      JSON.stringify({
        event: "site.check_failed",
        url: target.url,
        reason: result.reason,
        detail: result.detail,
      }),
    );
    return result;
  }
  await markWatchPolled(target.watchId, new Date().toISOString());
  return result;
}

function pageTextDiff(
  before: string | null,
  after: string | null,
  changed: ChangedPage,
): ReturnType<typeof diffPageText> | null {
  if (before === null || after === null) return null;
  return diffPageText(
    { text: before, hash: changed.previousHash, charCount: before.length },
    { text: after, hash: changed.hash, charCount: after.length },
  );
}

interface SiteChangeInput {
  target: SiteSweepTarget;
  changed: ChangedPage;
  diff: ReturnType<typeof diffPageText> | null;
  subject: { name: string | null; domain: string };
  evidence: ReturnType<typeof computeBreakageEvidence>;
}

function changeSignalPayload(
  input: Pick<SiteChangeInput, "target" | "changed" | "diff"> & { diffKey: string },
): string {
  const { target, changed, diff, diffKey } = input;
  const words = diff?.words ?? [];
  return JSON.stringify({
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
  });
}

function judgeInputFor(change: SiteChangeInput, signalId: string | null): JudgeInput {
  return {
    workspaceId: change.target.workspaceId,
    entityId: change.target.entityId,
    signalId,
    isSelf: change.target.entityRole === "self",
    subject: change.subject,
    pageUrl: change.target.url,
    pageRole: change.target.pageRole,
    hunks: change.diff === null ? [] : change.diff.hunks,
    evidence: change.evidence,
  };
}

async function judgeUnlessFailed(change: SiteChangeInput, signalId: string | null): Promise<JudgedChange | null> {
  try {
    return await judgeChange(judgeInputFor(change, signalId));
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "site.change_judge_failed",
        url: change.target.url,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return null;
  }
}

async function judgeCompetitorChange(change: SiteChangeInput): Promise<JudgedChange | null> {
  if (change.target.entityRole !== "competitor" || change.diff === null) return null;
  return judgeUnlessFailed(change, null);
}

async function fileChangeSignal(
  change: SiteChangeInput,
  payloadJson: string,
  judgment: JudgedChange | null,
): Promise<string> {
  const { target, changed } = change;
  const noteworthy = judgment?.noteworthy ?? null;
  const signalId = crypto.randomUUID();
  const insert = insertChangeSignalStatement({
    id: signalId,
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    sourceId: target.sourceId,
    watchId: target.watchId,
    snapshotId: changed.snapshotId,
    title: null,
    summary: null,
    aspect: noteworthy?.kind ?? target.pageRole,
    url: target.url,
    payloadJson,
    observedAt: new Date().toISOString(),
  });
  await insert.run();
  const filed = await env.DB.prepare("SELECT id FROM signal WHERE source_id = ?1 AND dedup_key = ?2")
    .bind(target.sourceId, changed.snapshotId)
    .first<{ id: string }>();
  if (filed === null) {
    throw new Error(`missing change signal for snapshot ${changed.snapshotId}`);
  }
  if (judgment !== null && judgment.verdictIds.length > 0) {
    await linkVerdictsStatement({
      signalId: filed.id,
      workspaceId: target.workspaceId,
      verdictIds: judgment.verdictIds,
    }).run();
  }
  return filed.id;
}

export async function publishSiteChange(target: SiteSweepTarget, changed: ChangedPage): Promise<string> {
  const [before, after] = await Promise.all([readText(changed.previousTextKey), readText(changed.textKey)]);
  const diff = pageTextDiff(before, after, changed);

  const diffKey = `snapshot/site/${target.watchId}/${changed.snapshotId}.diff.json`;
  if (diff !== null) {
    await env.SNAPSHOTS.put(diffKey, JSON.stringify({ hunks: diff.hunks }), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  const subject = await env.DB.prepare("SELECT name, domain FROM entity WHERE id = ?1 AND workspace_id = ?2")
    .bind(target.entityId, target.workspaceId)
    .first<{ name: string | null; domain: string }>();
  if (subject === null) {
    throw new Error(`missing entity ${target.entityId}`);
  }
  const change: SiteChangeInput = {
    target,
    changed,
    diff,
    subject,
    evidence: computeBreakageEvidence({ status: changed.status, beforeText: before ?? "", afterText: after ?? "" }),
  };

  const judgment = await judgeCompetitorChange(change);
  if (judgment?.noteworthy?.band === "discard") {
    console.log(JSON.stringify({ event: "site.change_discarded", url: target.url, kind: judgment.noteworthy.kind }));
    return changed.snapshotId;
  }

  const signalId = await fileChangeSignal(change, changeSignalPayload({ target, changed, diff, diffKey }), judgment);
  if (target.entityRole === "self") {
    await judgeUnlessFailed(change, signalId);
  }
  return changed.snapshotId;
}
