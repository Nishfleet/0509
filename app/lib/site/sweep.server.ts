import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { getDomain } from "tldts";

import { insertIncidentAlertStatement } from "../data/alert.server";
import { openIncidentStatement } from "../data/incident.server";
import {
  insertPages,
  readEntitiesWithoutHomePage,
  readUnwatchedPricingPages,
  syncPricingWatches,
} from "../data/page.server";
import { linkVerdictsStatement } from "../data/jev_verdict.server";
import { insertChangeSignalStatement } from "../data/signal.server";
import { hashSeenSince, readCoveredPagePairs } from "../data/snapshot.server";
import { readEnabledSourceId } from "../data/source.server";
import type { SiteSweepTarget } from "../data/watch.server";
import { readPaidWorkspaceIds } from "../data/plan.server";
import { insertWatches, markWatchPolled, readSiteSweepTargets, readUnwatchedEntities } from "../data/watch.server";
import { robotsAllows } from "../fetch/robots.server";
import { decodeHtmlEntities } from "../html";
import { normaliseSubject } from "../identity/normalise";
import { changeExcerpt } from "../site-change-excerpt";
import { takeBrowserScreenshot } from "./browser-budget.server";
import { breakageProof, computeBreakageEvidence } from "./breakage-evidence";
import type { CheckPageResult } from "./check-page.server";
import { checkPage } from "./check-page.server";
import { breakageConfirmed } from "./breakage-recheck.server";
import { changedWordCounts, diffPageText } from "./diff";
import type { JudgedChange, JudgeInput } from "./judge.server";
import { judgeChange } from "./judge.server";
import { readPage } from "./read-page.server";
import { rememberRivalDescription } from "./rival-profile.server";

const SITE_SOURCE_KEY = "site.web";

export const CHUNK_SIZE = 10;

export type ChangedPage = Extract<CheckPageResult, { outcome: "changed" }>;

async function readText(key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS.get(key);
  return object === null ? null : object.text();
}

function squash(text: string | null): string | null {
  return text === null ? null : text.replace(/\s+/g, " ").trim();
}

function sameVisibleText(changed: ChangedPage, before: string | null, after: string | null): boolean {
  return changed.previousTextKey !== changed.textKey && before !== null && squash(before) === squash(after);
}

const FLAP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function isFlapBack(target: SiteSweepTarget, changed: ChangedPage): Promise<boolean> {
  if (target.entityRole !== "competitor" || target.pageRole === "pricing") return false;
  return hashSeenSince({
    watchId: target.watchId,
    pageId: target.pageId,
    hash: changed.hash,
    exceptId: changed.snapshotId,
    since: new Date(Date.now() - FLAP_WINDOW_MS).toISOString(),
  });
}

async function storedLang(key: string): Promise<string | null> {
  const head = await env.SNAPSHOTS.head(key);
  return head?.customMetadata?.lang ?? null;
}

async function isLocaleSwitch(target: SiteSweepTarget, changed: ChangedPage): Promise<boolean> {
  if (target.entityRole !== "competitor") return false;
  const [before, after] = await Promise.all([storedLang(changed.previousTextKey), storedLang(changed.textKey)]);
  return before !== null && after !== null && before !== after;
}

async function skipEvent(
  target: SiteSweepTarget,
  changed: ChangedPage,
  text: { before: string | null; after: string | null },
): Promise<string | null> {
  if (sameVisibleText(changed, text.before, text.after)) return "site.change_same_text";
  if (await isLocaleSwitch(target, changed)) return "site.change_locale_switch";
  if (await isFlapBack(target, changed)) return "site.change_flap";
  return null;
}

async function readVisibleText(key: string): Promise<string | null> {
  const raw = await readText(key);
  return raw === null ? null : decodeHtmlEntities(raw);
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

function homeUrl(entity: { id: string; domain: string; url: string | null; identity_valid: boolean }): string | null {
  if (!entity.identity_valid) {
    console.warn(JSON.stringify({ event: "site-sweep.identity-json-invalid", entityId: entity.id }));
  }
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
  await syncPricingWatches(sourceId);
  const pricing = await readUnwatchedPricingPages(sourceId);
  await insertWatches(
    pricing.map((page) => ({ id: crypto.randomUUID(), entityId: page.entityId, sourceId, targetKey: page.url })),
  );
  const paid = await readPaidWorkspaceIds(new Date(now));
  return (await readSiteSweepTargets(SITE_SOURCE_KEY)).filter((target) => paid.has(target.workspaceId));
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

const URL_PATTERN = /https?:\/\/\S+/g;
const HOST_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

function redactedDetail(detail: string): string {
  return detail.replace(URL_PATTERN, "<url>").replace(HOST_PATTERN, "<host>").slice(0, 300);
}

export async function checkSitePage(
  target: SiteSweepTarget,
  tick: SweepTick,
  options: CheckSitePageOptions = {},
): Promise<CheckPageResult> {
  if (target.entityRole === "self" && !(await robotsAllows(target.url))) {
    console.warn(
      JSON.stringify({
        event: "site.check_failed",
        pageId: target.pageId,
        reason: "robots",
        detail: "disallowed by robots.txt",
      }),
    );
    return { outcome: "failed", reason: "robots", detail: "disallowed by robots.txt" };
  }
  const read = await readPage(target, tick.plannedAt, { browser: options.browser ?? true });
  await rememberRivalDescription(target, read);
  const result = await checkPage({
    watchId: target.watchId,
    pageId: target.pageId,
    url: target.url,
    snapshotId: `${tick.instanceId}-${target.pageId}`,
    before: tick.plannedAt,
    read,
    mayScreenshot:
      options.browser === false || (read.ok && read.fromArchive === true)
        ? undefined
        : () => takeBrowserScreenshot(target.workspaceId, target.entityId, tick.plannedAt.slice(0, 10)),
  });
  if (result.outcome === "failed") {
    console.warn(
      JSON.stringify({
        event: "site.check_failed",
        pageId: target.pageId,
        reason: result.reason,
        detail: redactedDetail(result.detail),
      }),
    );
    return result;
  }
  if (result.outcome === "gone") {
    console.log(JSON.stringify({ event: "site.check_gone", pageId: target.pageId }));
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
  const counts = changedWordCounts(diff);
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
    excerpt: diff === null ? [] : changeExcerpt(diff.hunks.map((hunk) => hunk.lines)),
    wordsAdded: counts.added,
    wordsRemoved: counts.removed,
    status: changed.status,
    transport: changed.transport,
    ...(changed.viaArchive ? { viaArchive: true } : {}),
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
    console.warn(
      JSON.stringify({
        event: "site.change_judge_failed",
        pageId: change.target.pageId,
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

async function judgeSelfChange(change: SiteChangeInput): Promise<JudgedChange | null> {
  if (change.target.entityRole !== "self" || change.diff === null) return null;
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

interface BreakageFiling {
  payloadJson: string;
  judgment: JudgedChange;
  band: "alert" | "check";
}

function breakageStatements(
  change: SiteChangeInput,
  filing: BreakageFiling,
  ids: { signal: string; incident: string },
) {
  const { target, changed, subject } = change;
  const now = new Date().toISOString();
  return [
    insertChangeSignalStatement({
      id: ids.signal,
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      sourceId: target.sourceId,
      watchId: target.watchId,
      snapshotId: changed.snapshotId,
      title: null,
      summary: null,
      aspect: "breakage",
      url: target.url,
      payloadJson: filing.payloadJson,
      observedAt: now,
    }),
    openIncidentStatement({
      id: ids.incident,
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      pageId: target.pageId,
      kind: "breakage",
      openedAt: now,
    }),
    insertIncidentAlertStatement({
      id: `incident-${ids.incident}`,
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      pageId: target.pageId,
      signalId: ids.signal,
      incidentId: ids.incident,
      severity: filing.band === "alert" ? "high" : "normal",
      title: `${subject.domain} looks broken`,
      body: breakageProof(change.evidence),
      createdAt: now,
    }),
  ];
}

async function openBreakageIncident(change: SiteChangeInput, filing: BreakageFiling): Promise<void> {
  const ids = { signal: crypto.randomUUID(), incident: crypto.randomUUID() };
  const results = await env.DB.batch(breakageStatements(change, filing, ids));
  if (results[0]?.meta.changes === 1 && filing.judgment.verdictIds.length > 0) {
    await linkVerdictsStatement({
      signalId: ids.signal,
      workspaceId: change.target.workspaceId,
      verdictIds: filing.judgment.verdictIds,
    }).run();
  }
  if (results[1]?.meta.changes === 1 && filing.band === "alert") {
    await env.SEND_EMAIL.send({ incident_id: ids.incident });
  }
}

async function storeDiff(diffKey: string, diff: ReturnType<typeof diffPageText> | null) {
  if (diff === null) return;
  await env.SNAPSHOTS.put(diffKey, JSON.stringify({ hunks: diff.hunks }), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function emailPricingChange(signalId: string, judgment: JudgedChange | null): Promise<void> {
  if (judgment?.noteworthy?.band !== "publish" || judgment.noteworthy.kind !== "pricing") return;
  try {
    await env.SEND_EMAIL.send({ signal_id: signalId });
  } catch (error) {
    console.warn(JSON.stringify({ event: "site.change_email_enqueue_failed", signalId }));
    captureException(error, { tags: { queue: "send-email", lane: "change" } });
  }
}

async function fileUnlessDiscarded(change: SiteChangeInput, payloadJson: string, selfJudgment: JudgedChange | null) {
  const { target } = change;
  const competitorJudgment = await judgeCompetitorChange(change);
  if (competitorJudgment?.noteworthy?.band === "discard") {
    console.warn(
      JSON.stringify({
        event: "site.change_discarded",
        pageId: target.pageId,
        kind: competitorJudgment.noteworthy.kind,
      }),
    );
    return;
  }
  const signalId = await fileChangeSignal(change, payloadJson, selfJudgment ?? competitorJudgment);
  await emailPricingChange(signalId, competitorJudgment);
  if (target.entityRole === "self" && change.diff === null) {
    await judgeUnlessFailed(change, signalId);
  }
}

async function confirmedBreakageBand(
  change: SiteChangeInput,
  judgment: JudgedChange | null,
  beforeKey: string,
): Promise<"alert" | "check" | null> {
  const band = judgment?.selfBreakage?.band;
  if (band !== "alert" && band !== "check") return null;
  return (await breakageConfirmed(change.evidence, change.target.url, beforeKey)) ? band : null;
}

export async function publishSiteChange(target: SiteSweepTarget, changed: ChangedPage): Promise<string> {
  const [before, after] = await Promise.all([
    readVisibleText(changed.previousTextKey),
    readVisibleText(changed.textKey),
  ]);
  const skipped = await skipEvent(target, changed, { before, after });
  if (skipped !== null) {
    console.log(JSON.stringify({ event: skipped, pageId: target.pageId }));
    return changed.snapshotId;
  }
  const diff = pageTextDiff(before, after, changed);
  const diffKey = `snapshot/site/${target.watchId}/${changed.snapshotId}.diff.json`;
  await storeDiff(diffKey, diff);

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

  const payloadJson = changeSignalPayload({ target, changed, diff, diffKey });
  const selfJudgment = await judgeSelfChange(change);
  const band = await confirmedBreakageBand(change, selfJudgment, changed.previousTextKey);
  if (selfJudgment !== null && band !== null) {
    await openBreakageIncident(change, { payloadJson, judgment: selfJudgment, band });
  } else {
    await fileUnlessDiscarded(change, payloadJson, selfJudgment);
  }
  return changed.snapshotId;
}
