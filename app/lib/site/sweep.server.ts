import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { insertPages, readEntitiesWithoutHomePage } from "../data/page.server";
import { linkVerdictsStatement } from "../data/jev_verdict.server";
import { insertChangeSignalStatement } from "../data/signal.server";
import { readCoveredPagePairs } from "../data/snapshot.server";
import { readEnabledSourceId } from "../data/source.server";
import type { SiteSweepTarget } from "../data/watch.server";
import {
  insertWatches,
  markWatchPolled,
  readSiteSweepTargets,
  readUnwatchedEntities,
} from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import { normaliseSubject } from "../identity/normalise";
import { takeBrowserScreenshot } from "./browser-budget.server";
import { computeBreakageEvidence } from "./breakage-evidence";
import type { CheckPageResult } from "./check-page.server";
import { checkPage } from "./check-page.server";
import { diffPageText } from "./diff";
import type { ChangeJudgment } from "./judge.server";
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
      return url === null
        ? []
        : [{ id: crypto.randomUUID(), entityId: entity.id, sourceId, targetKey: url }];
    }),
  );
  return [...(await readSiteSweepTargets(SITE_SOURCE_KEY))];
}

export async function uncoveredItems(
  items: readonly SiteSweepTarget[],
  sinceIso: string,
): Promise<SiteSweepTarget[]> {
  if (items.length === 0) return [];
  const covered = new Set(
    (await readCoveredPagePairs(sinceIso, items.map((item) => item.watchId))).map(
      (row) => `${row.watchId}|${row.pageId}`,
    ),
  );
  return items.filter((item) => !covered.has(`${item.watchId}|${item.pageId}`));
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
  const read = await readPage(target, tick.plannedAt);
  const result = await checkPage({
    watchId: target.watchId,
    pageId: target.pageId,
    url: target.url,
    snapshotId: `${tick.instanceId}-${target.pageId}`,
    before: tick.plannedAt,
    read,
    mayScreenshot: () =>
      takeBrowserScreenshot(target.workspaceId, target.entityId, tick.plannedAt.slice(0, 10)),
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

interface SiteChangeInput {
  target: SiteSweepTarget;
  changed: ChangedPage;
  diff: ReturnType<typeof diffPageText> | null;
  before: string | null;
  after: string | null;
}

function changeSignalPayload(input: {
  target: SiteSweepTarget;
  changed: ChangedPage;
  diff: ReturnType<typeof diffPageText> | null;
  diffKey: string;
}): object {
  const words = input.diff?.words ?? [];
  return {
    page: { role: input.target.pageRole, url: input.target.url },
    before: {
      snapshotId: input.changed.previousSnapshotId,
      textKey: input.changed.previousTextKey,
      screenshotKey: input.changed.previousScreenshotKey,
    },
    after: {
      snapshotId: input.changed.snapshotId,
      textKey: input.changed.textKey,
      screenshotKey: input.changed.screenshotKey,
    },
    diffKey: input.diff === null ? null : input.diffKey,
    wordsAdded: words.filter((c) => c.added).reduce((n, c) => n + wordCount(c.value), 0),
    wordsRemoved: words.filter((c) => c.removed).reduce((n, c) => n + wordCount(c.value), 0),
    status: input.changed.status,
    transport: input.changed.transport,
  };
}

async function judgeCompetitorChange(change: SiteChangeInput): Promise<ChangeJudgment | null> {
  if (change.target.entityRole !== "competitor" || change.diff === null) return null;
  const { judgeChange } = await import("./judge.server");
  return judgeChange({
    workspaceId: change.target.workspaceId,
    entityId: change.target.entityId,
    isSelf: false,
    subject: { name: null, domain: change.target.domain },
    pageUrl: change.target.url,
    pageRole: change.target.pageRole,
    hunks: change.diff.hunks,
    evidence: computeBreakageEvidence({
      status: change.changed.status,
      beforeText: change.before ?? "",
      afterText: change.after ?? "",
    }),
  });
}

async function fileChangeSignal(
  change: SiteChangeInput & { payloadJson: string; judgment: ChangeJudgment | null; judgedFrom: string },
): Promise<void> {
  const { target, changed, payloadJson, judgment, judgedFrom } = change;
  const noteworthy = judgment?.noteworthy ?? null;
  if (noteworthy?.band === "discard") {
    console.log(JSON.stringify({
      event: "site.change_discarded",
      url: target.url,
      kind: noteworthy.kind,
    }));
    return;
  }

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

  if (noteworthy === null) {
    await insert.run();
    return;
  }

  const { D3_CHANGE_QUESTION_IDS } = await import("./judge.server");
  await env.DB.batch([
    insert,
    linkVerdictsStatement({
      signalId,
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      since: judgedFrom,
      questionIds: D3_CHANGE_QUESTION_IDS,
    }),
  ]);
}

export async function publishSiteChange(target: SiteSweepTarget, changed: ChangedPage): Promise<string> {
  const judgedFrom = new Date().toISOString();
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

  const change: SiteChangeInput = { target, changed, diff, before, after };
  await fileChangeSignal({
    ...change,
    payloadJson: JSON.stringify(changeSignalPayload({ target, changed, diff, diffKey })),
    judgment: await judgeCompetitorChange(change),
    judgedFrom,
  });
  return changed.snapshotId;
}
