import { env } from "cloudflare:workers";

import { insertSignalAlert } from "../../app/lib/data/alert.server";
import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { readDiscoveryContext, readEntityIdentityJson } from "../../app/lib/data/entity.server";
import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import {
  type DuplicateCandidate,
  findDuplicateCandidate,
  insertMention,
  markDuplicateOf,
  type MentionSignal,
  readSeenDedupKeys,
  readUnjudgedMentions,
  type UnjudgedMention,
  resolveUnjudgedMention,
} from "../../app/lib/data/signal.server";
import { insertWatchSnapshot } from "../../app/lib/data/snapshot.server";
import { markSourceTimedOut } from "../../app/lib/data/source.server";
import type { WatchRow } from "../../app/lib/data/watch.server";
import {
  advanceHnCursor,
  markWatchPolled,
  readActiveWatches,
  readWatchConfigJson,
  writeWatchConfigJson,
} from "../../app/lib/data/watch.server";
import type { NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import { withMentionCall } from "../../app/lib/mentions/call-budget.server";
import { lookupYoutubeChannel } from "../../app/lib/identity/youtube-channel.server";
import { noulAction } from "../../app/lib/jev/thresholds";
import { mentionReasonLine } from "../../app/lib/mentions/reason-customer";
import {
  ABOUT_BRAND,
  aboutBrandState,
  DUPLICATE_SIGNAL,
  duplicateSignalState,
  MATTERS,
  mentionMattersState,
} from "../../app/lib/mentions/questions";
import {
  readWatchConfig,
  withLostChannel,
  withNoChannel,
  withoutLostChannel,
  withoutNoChannel,
  withPendingChannel,
  withResolvedChannel,
  withoutPendingChannel,
} from "../../app/lib/mentions/youtube-channel";
import { isHnPlugin, newestEpoch, predatesWatch, startCursor } from "../../app/lib/mentions/hn-window";
import { sha256Hex } from "../../app/lib/sha256";
import { storedDedupKey, toSignalRow, type MentionItem, type SignalRow } from "./map";
import { recordUpstreamBlock, writeSourcePoint } from "./canary";
import { adapterFor } from "../sources/registry";
import { youtubeAdapter } from "../sources/mentions/youtube";
import { isUpstreamTimeout, UpstreamBlockedError } from "../sources/mentions/types";
import type { OkYoutubeFeed } from "../sources/mentions/youtube";

const JUDGED_PER_WATCH = 12;

const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface MentionTarget {
  sourceId: string;
  pluginKey: string;
  query: string;
  minIntervalSeconds: number;
  watches: WatchRow[];
}

export interface TargetOutcome {
  items: number;
  stored: number;
  unjudged: number;
  skipped: number;
}

export async function planTargets(): Promise<MentionTarget[]> {
  const watches = await readActiveWatches("mentions");
  const byTarget = new Map<string, MentionTarget>();
  for (const watch of watches) {
    const key = `${watch.source_id}\u0000${watch.target_key}`;
    const existing = byTarget.get(key);
    byTarget.set(key, {
      sourceId: watch.source_id,
      pluginKey: watch.plugin_key,
      query: watch.target_key,
      minIntervalSeconds: watch.min_interval_seconds,
      watches: [...(existing?.watches ?? []), watch],
    });
  }
  return [...byTarget.values()];
}

function subjectOf(watch: WatchRow) {
  return { name: watch.name, domain: watch.domain, role: watch.role };
}

type JudgedItem = Pick<MentionItem, "title" | "url" | "publishedAt" | "publisher">;

interface JudgeScope {
  context: DiscoveryContext;
  now: string;
}

async function judge(
  watch: WatchRow,
  scope: JudgeScope,
  item: JudgedItem,
): Promise<{ about: NoulVerdict; matters: NoulVerdict | null }> {
  const subject = subjectOf(watch);
  const about = await withMentionCall(watch.entity_id, () =>
    askNoul(watch.workspace_id, ABOUT_BRAND, aboutBrandState({ subject, item, reliability: watch.reliability })),
  );
  if (noulAction(about.p) === "reject") return { about, matters: null };
  const { context } = scope;
  const mattersState = mentionMattersState({
    self: { name: context.self.name, domain: context.self.domain, description: context.self.description },
    subject,
    competitors: context.competitors,
    item,
    reliability: watch.reliability,
    today: scope.now.slice(0, 10),
  });
  const matters = await withMentionCall(watch.entity_id, () => askNoul(watch.workspace_id, MATTERS, mattersState));
  return { about, matters };
}

async function judgeOrNull(
  watch: WatchRow,
  scope: JudgeScope,
  item: JudgedItem,
): Promise<{ about: NoulVerdict; matters: NoulVerdict | null } | null> {
  try {
    return await judge(watch, scope, item);
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    console.error(JSON.stringify({ event: "mentions.jev_unavailable", message: error.message }));
    return null;
  }
}

function mentionAlert(input: {
  watch: WatchRow;
  signalId: string;
  item: JudgedItem;
  now: string;
}): D1PreparedStatement {
  return insertSignalAlert(env.DB, {
    workspaceId: input.watch.workspace_id,
    entityId: input.watch.entity_id,
    signalId: input.signalId,
    kind: "mention",
    title: `${input.watch.name}: ${input.item.title}`,
    body: input.item.publisher ?? null,
    createdAt: input.now,
  });
}

function judgedStatements(input: {
  watch: WatchRow;
  signalId: string;
  item: JudgedItem;
  verdicts: { about: NoulVerdict; matters: NoulVerdict | null };
  now: string;
}): D1PreparedStatement[] {
  const { watch, signalId, verdicts, now } = input;
  const verdictRow = (verdict: NoulVerdict, reason: string | null) =>
    insertVerdict({
      workspaceId: watch.workspace_id,
      questionId: verdict.questionId,
      inputHash: verdict.inputHash,
      signalId,
      entityId: watch.entity_id,
      p: verdict.p,
      choice: null,
      reason,
      decidedAt: now,
    });
  const statements = [verdictRow(verdicts.about, null)];
  if (verdicts.matters === null) return statements;
  statements.push(verdictRow(verdicts.matters, mentionReasonLine(noulAction(verdicts.matters.p))));
  return statements;
}

function alertStatements(input: {
  watch: WatchRow;
  signalId: string;
  item: JudgedItem;
  verdicts: { matters: NoulVerdict | null };
  collapsed: boolean;
  now: string;
}): D1PreparedStatement[] {
  const { watch, signalId, item, verdicts, now } = input;
  if (input.collapsed || verdicts.matters === null || noulAction(verdicts.matters.p) !== "act") return [];
  return [mentionAlert({ watch, signalId, item, now })];
}

function duplicateStatements(input: {
  watch: WatchRow;
  signalId: string;
  candidateId: string;
  verdict: NoulVerdict;
  now: string;
}): D1PreparedStatement[] {
  const { watch, signalId, candidateId, verdict, now } = input;
  const verdictRow = insertVerdict({
    workspaceId: watch.workspace_id,
    questionId: verdict.questionId,
    inputHash: verdict.inputHash,
    signalId,
    entityId: watch.entity_id,
    p: verdict.p,
    choice: null,
    reason: null,
    decidedAt: now,
  });
  return noulAction(verdict.p) === "act" ? [verdictRow, markDuplicateOf(signalId, candidateId)] : [verdictRow];
}

interface SweepPeer {
  titleHash: string;
  normUrlHash: string;
  candidate: DuplicateCandidate;
}

type DuplicateHashes = Pick<SweepPeer, "titleHash" | "normUrlHash">;

function asCandidate(watch: WatchRow, signalId: string, item: JudgedItem): DuplicateCandidate {
  return {
    id: signalId,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    publisher: item.publisher ?? null,
    source: watch.plugin_key,
  };
}

async function pickCandidate(input: {
  watch: WatchRow;
  signalId: string;
  hashes: DuplicateHashes;
  peers: readonly SweepPeer[];
  now: string;
}): Promise<DuplicateCandidate | null> {
  const { watch, hashes, peers, now } = input;
  const stored = await findDuplicateCandidate({
    workspaceId: watch.workspace_id,
    entityId: watch.entity_id,
    excludeId: input.signalId,
    since: new Date(Date.parse(now) - DUPLICATE_WINDOW_MS).toISOString(),
    ...hashes,
  });
  if (stored !== null) return stored;
  const peer = peers.find((entry) => entry.titleHash === hashes.titleHash || entry.normUrlHash === hashes.normUrlHash);
  return peer?.candidate ?? null;
}

interface DuplicateOutcome {
  statements: D1PreparedStatement[];
  asked: boolean;
  jevDown: boolean;
  collapsed: boolean;
  blocked: boolean;
}

const NO_DUPLICATE_CHECK: DuplicateOutcome = {
  statements: [],
  asked: false,
  jevDown: false,
  collapsed: false,
  blocked: false,
};

async function judgeDuplicate(input: {
  watch: WatchRow;
  signalId: string;
  item: JudgedItem;
  hashes: DuplicateHashes;
  peers: readonly SweepPeer[];
  now: string;
  canAsk: () => boolean;
}): Promise<DuplicateOutcome> {
  const { watch, signalId, item, now } = input;
  const candidate = await pickCandidate({ watch, signalId, hashes: input.hashes, peers: input.peers, now });
  if (candidate === null) return { ...NO_DUPLICATE_CHECK };
  if (!input.canAsk()) return { ...NO_DUPLICATE_CHECK, blocked: true };
  const state = duplicateSignalState({
    subject: { name: watch.name, domain: watch.domain },
    first: asCandidate(watch, signalId, item),
    second: candidate,
  });
  try {
    const verdict = await withMentionCall(watch.entity_id, () => askNoul(watch.workspace_id, DUPLICATE_SIGNAL, state));
    const statements = duplicateStatements({ watch, signalId, candidateId: candidate.id, verdict, now });
    return { ...NO_DUPLICATE_CHECK, statements, asked: true, collapsed: noulAction(verdict.p) === "act" };
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    console.error(JSON.stringify({ event: "mentions.jev_unavailable", message: error.message }));
    return { ...NO_DUPLICATE_CHECK, asked: true, jevDown: true, blocked: true };
  }
}

interface Rejudged {
  statements: D1PreparedStatement[];
  stored: number;
  attempted: number;
  jevDown: boolean;
  peers: readonly SweepPeer[];
}

function acceptedStatements(input: {
  watch: WatchRow;
  row: UnjudgedMention;
  verdicts: { about: NoulVerdict; matters: NoulVerdict | null };
  duplicate: DuplicateOutcome;
  now: string;
}): D1PreparedStatement[] {
  const { watch, row, verdicts, duplicate, now } = input;
  return [
    resolveUnjudgedMention(row.id, false),
    ...judgedStatements({ watch, signalId: row.id, item: row, verdicts, now }),
    ...alertStatements({ watch, signalId: row.id, item: row, verdicts, collapsed: duplicate.collapsed, now }),
    ...duplicate.statements,
  ];
}

async function rejudgeUnjudged(watch: WatchRow, scope: JudgeScope): Promise<Rejudged> {
  const { now } = scope;
  const pending = await readUnjudgedMentions(watch.watch_id, JUDGED_PER_WATCH);
  const statements: D1PreparedStatement[] = [];
  let peers: readonly SweepPeer[] = [];
  let stored = 0;
  let asks = JUDGED_PER_WATCH;
  const result = (jevDown: boolean): Rejudged => ({ statements, stored, attempted: pending.length, jevDown, peers });
  for (const row of pending) {
    const verdicts = await judgeOrNull(watch, scope, row);
    if (verdicts === null) return result(true);
    if (noulAction(verdicts.about.p) === "reject") {
      statements.push(
        resolveUnjudgedMention(row.id, true),
        ...judgedStatements({ watch, signalId: row.id, item: row, verdicts, now }),
      );
      continue;
    }
    const hashes = { titleHash: row.titleHash, normUrlHash: row.normUrlHash };
    const duplicate = await judgeDuplicate({
      watch,
      signalId: row.id,
      item: row,
      hashes,
      peers,
      now,
      canAsk: () => asks > 0,
    });
    if (duplicate.asked) asks -= 1;
    if (duplicate.jevDown) return result(true);
    if (duplicate.blocked) continue;
    statements.push(...acceptedStatements({ watch, row, verdicts, duplicate, now }));
    peers = [...peers, { ...hashes, candidate: asCandidate(watch, row.id, row) }];
    stored += 1;
  }
  return result(false);
}

function mentionSignal(input: {
  mapped: SignalRow;
  watch: WatchRow;
  snapshotId: string;
  signalId: string;
  dedupKey: string;
  rejected: boolean;
  judged: boolean;
}): MentionSignal {
  const { mapped, watch } = input;
  return {
    id: input.signalId,
    workspaceId: mapped.workspace_id,
    entityId: mapped.entity_id,
    sourceId: mapped.source_id,
    watchId: watch.watch_id,
    snapshotId: input.snapshotId,
    title: mapped.title,
    url: mapped.canonical_url,
    urlHash: mapped.url_hash,
    titleHash: mapped.title_hash,
    normUrlHash: mapped.norm_url_hash,
    author: mapped.author,
    engagementJson: mapped.engagement_json,
    payloadJson: mapped.payload_json,
    dedupKey: input.dedupKey,
    publishedAt: mapped.published_at,
    observedAt: mapped.observed_at,
    isNotAboutBrand: input.rejected,
    state: input.judged ? "judged" : "unjudged",
  };
}

async function mapFresh(input: { watch: WatchRow; item: MentionItem; snapshotId: string; now: string }) {
  const { watch, item, snapshotId, now } = input;
  const mapped = await toSignalRow(item, {
    workspaceId: watch.workspace_id,
    entityId: watch.entity_id,
    sourceId: watch.source_id,
    watchId: watch.watch_id,
    snapshotId,
    observedAt: now,
  });
  const dedupKey = storedDedupKey(watch.entity_id, mapped.dedup_key);
  const signalId = `sig-${(await sha256Hex(`${watch.source_id}:${dedupKey}`)).slice(0, 32)}`;
  return { mapped, dedupKey, signalId };
}

interface FreshMentionInput {
  watch: WatchRow;
  context: DiscoveryContext;
  item: MentionItem;
  snapshotId: string;
  now: string;
  jevDown: boolean;
  peers: readonly SweepPeer[];
  canAsk: () => boolean;
}

interface FreshMentionResult {
  statements: D1PreparedStatement[];
  peer: SweepPeer | null;
  stored: number;
  unjudged: number;
  asked: boolean;
  jevDown: boolean;
}

function deferredMention(insert: D1PreparedStatement, outcome: { asked: boolean; jevDown: boolean }) {
  return { statements: [insert], peer: null, stored: 0, unjudged: 1, ...outcome };
}

async function freshMentionStatements(input: FreshMentionInput): Promise<FreshMentionResult> {
  const { watch, item, snapshotId, now } = input;
  const verdicts = input.jevDown ? null : await judgeOrNull(watch, { context: input.context, now }, item);
  const { mapped, dedupKey, signalId } = await mapFresh({ watch, item, snapshotId, now });
  const rejected = verdicts !== null && noulAction(verdicts.about.p) === "reject";
  const signal = { mapped, watch, snapshotId, signalId, dedupKey, rejected };
  const unjudgedInsert = insertMention(mentionSignal({ ...signal, judged: false }));
  if (verdicts === null) return deferredMention(unjudgedInsert, { asked: false, jevDown: true });
  const insert = insertMention(mentionSignal({ ...signal, judged: true }));
  const judged = [insert, ...judgedStatements({ watch, signalId, item, verdicts, now })];
  if (rejected) return { statements: judged, peer: null, stored: 0, unjudged: 0, asked: false, jevDown: false };
  const hashes = { titleHash: mapped.title_hash, normUrlHash: mapped.norm_url_hash };
  const duplicate = await judgeDuplicate({
    watch,
    signalId,
    item,
    hashes,
    peers: input.peers,
    now,
    canAsk: input.canAsk,
  });
  if (duplicate.blocked) return deferredMention(unjudgedInsert, { asked: duplicate.asked, jevDown: duplicate.jevDown });
  const alert = alertStatements({ watch, signalId, item, verdicts, collapsed: duplicate.collapsed, now });
  return {
    statements: [...judged, ...alert, ...duplicate.statements],
    peer: { ...hashes, candidate: asCandidate(watch, signalId, item) },
    stored: 1,
    unjudged: 0,
    asked: duplicate.asked,
    jevDown: duplicate.jevDown,
  };
}

interface JudgeFreshInput {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshotId: string;
  now: string;
  jevDown: boolean;
  budget: number;
  peers: readonly SweepPeer[];
}

async function judgeFreshItems(
  input: JudgeFreshInput,
): Promise<{ statements: D1PreparedStatement[]; stored: number; unjudged: number }> {
  const { watch, context, snapshotId, now } = input;
  const statements: D1PreparedStatement[] = [];
  let stored = 0;
  let unjudged = 0;
  let jevDown = input.jevDown;
  let budget = input.budget;
  let peers = input.peers;
  const leftover: MentionItem[] = [];
  for (const item of input.items) {
    if (budget <= 0) {
      leftover.push(item);
      continue;
    }
    budget -= 1;
    const done = await freshMentionStatements({
      watch,
      context,
      item,
      snapshotId,
      now,
      jevDown,
      peers,
      canAsk: () => budget > 0,
    });
    if (done.peer !== null) peers = [...peers, done.peer];
    if (done.asked) budget -= 1;
    jevDown = done.jevDown;
    statements.push(...done.statements);
    stored += done.stored;
    unjudged += done.unjudged;
  }
  const deferred = await unjudgedRemainder({
    watch,
    context,
    items: leftover,
    snapshotId,
    now,
    peers,
  });
  statements.push(...deferred.statements);
  unjudged += deferred.unjudged;
  return { statements, stored, unjudged };
}

async function unjudgedRemainder(input: {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshotId: string;
  now: string;
  peers: readonly SweepPeer[];
}): Promise<{ statements: D1PreparedStatement[]; unjudged: number }> {
  const statements: D1PreparedStatement[] = [];
  let unjudged = 0;
  for (const item of input.items) {
    const deferred = await freshMentionStatements({
      watch: input.watch,
      context: input.context,
      item,
      snapshotId: input.snapshotId,
      now: input.now,
      jevDown: true,
      peers: input.peers,
      canAsk: () => false,
    });
    statements.push(...deferred.statements);
    unjudged += deferred.unjudged;
  }
  return { statements, unjudged };
}

async function statementsForWatch(input: {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshot: { r2Key: null; hash: string };
  canaryCount: number | null;
  now: string;
}): Promise<{ statements: D1PreparedStatement[]; stored: number; unjudged: number }> {
  const { watch, context, items, snapshot, canaryCount, now } = input;
  const snapshotId = crypto.randomUUID();
  const keyed = items.map((item) => ({
    item,
    dedupKey: storedDedupKey(watch.entity_id, item.dedupKey),
  }));
  const seen = await readSeenDedupKeys(
    watch.source_id,
    keyed.map((entry) => entry.dedupKey),
  );
  const fresh = keyed.filter((entry) => !seen.has(entry.dedupKey));
  const statements: D1PreparedStatement[] = [
    ...insertWatchSnapshot({
      id: snapshotId,
      watchId: watch.watch_id,
      fetchedAt: now,
      r2Key: snapshot.r2Key,
      hash: snapshot.hash,
      itemCount: items.length,
      canaryCount,
    }),
  ];
  const rejudged = await rejudgeUnjudged(watch, { context, now });
  statements.push(...rejudged.statements);
  const { jevDown } = rejudged;
  const freshJudged = await judgeFreshItems({
    watch,
    context,
    items: fresh.map((entry) => entry.item),
    snapshotId,
    now,
    jevDown,
    budget: jevDown ? JUDGED_PER_WATCH : JUDGED_PER_WATCH - rejudged.attempted,
    peers: rejudged.peers,
  });
  statements.push(...freshJudged.statements);
  return { statements, stored: rejudged.stored + freshJudged.stored, unjudged: freshJudged.unjudged };
}

async function advanceCursor(pluginKey: string, watchId: string, items: readonly MentionItem[]): Promise<void> {
  const cursor = newestEpoch(items);
  if (isHnPlugin(pluginKey) && cursor !== null) await advanceHnCursor(watchId, cursor);
}

async function hashMentionBody(rawBody: string): Promise<{ r2Key: null; hash: string }> {
  return { r2Key: null, hash: await sha256Hex(rawBody) };
}

async function commitMentionWatch(input: {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshot: { r2Key: null; hash: string };
  canaryCount: number | null;
  now: string;
}): Promise<{ stored: number; unjudged: number }> {
  const { watch, context, items, snapshot, canaryCount, now } = input;
  const titled = items.filter(
    (item) => item.title.trim() !== "" && !predatesWatch(watch.plugin_key, watch.watch_created_at, item.publishedAt),
  );
  const written = await statementsForWatch({
    watch,
    context,
    items: titled,
    snapshot,
    canaryCount,
    now,
  });
  await env.DB.batch(written.statements);
  await markWatchPolled(watch.watch_id, now);
  return { stored: written.stored, unjudged: written.unjudged };
}

async function requireWatchConfigJson(watchId: string): Promise<string> {
  const raw = await readWatchConfigJson(watchId);
  if (raw === null) throw new Error(`watch ${watchId} is missing`);
  return raw;
}

async function requireEntityIdentityJson(workspaceId: string, entityId: string): Promise<string> {
  const raw = await readEntityIdentityJson(workspaceId, entityId);
  if (raw === null) throw new Error(`entity ${entityId} is missing`);
  return raw;
}

async function flagLostChannel(watchId: string, now: string): Promise<void> {
  const current = await requireWatchConfigJson(watchId);
  const flagged = withLostChannel(withoutNoChannel(current), now);
  if (flagged !== current) await writeWatchConfigJson(watchId, flagged);
}

async function flagNoChannel(watchId: string, now: string): Promise<void> {
  const current = await requireWatchConfigJson(watchId);
  const flagged = withNoChannel(withoutLostChannel(current), now);
  if (flagged !== current) await writeWatchConfigJson(watchId, flagged);
}

interface YoutubeRun {
  now: string;
  canaryCount: number | null;
}

async function commitYoutubeFeed(input: {
  watch: WatchRow;
  feed: OkYoutubeFeed;
  run: YoutubeRun;
  channelId: string;
}): Promise<TargetOutcome> {
  const { watch, feed, run, channelId } = input;
  const { now, canaryCount } = run;
  const current = await requireWatchConfigJson(watch.watch_id);
  const currentConfig = readWatchConfig(current);
  if (
    currentConfig.status === "ok" &&
    (currentConfig.channelId !== channelId ||
      currentConfig.degraded !== null ||
      currentConfig.noChannel !== null ||
      currentConfig.pendingChannelId !== null)
  ) {
    await writeWatchConfigJson(watch.watch_id, withResolvedChannel(current, channelId));
  }
  const snapshot = await hashMentionBody(feed.rawBody);
  const context = await readDiscoveryContext(watch.workspace_id);
  if (context === null) return { items: feed.items.length, stored: 0, unjudged: 0, skipped: 0 };
  const committed = await commitMentionWatch({
    watch,
    context,
    items: feed.items,
    snapshot,
    canaryCount,
    now,
  });
  return { items: feed.items.length, stored: committed.stored, unjudged: committed.unjudged, skipped: 0 };
}

async function verifyPendingYoutube(watch: WatchRow, pendingId: string, run: YoutubeRun): Promise<TargetOutcome> {
  const { now } = run;
  const result = await youtubeAdapter({ query: pendingId }, null);
  if (result.feedState === "ok") {
    return commitYoutubeFeed({ watch, feed: result, run, channelId: pendingId });
  }
  if (result.feedState === "stale") {
    const current = await requireWatchConfigJson(watch.watch_id);
    const flagged = withLostChannel(withoutPendingChannel(current), now);
    await writeWatchConfigJson(watch.watch_id, flagged);
  }
  await markWatchPolled(watch.watch_id, now);
  return { items: 0, stored: 0, unjudged: 0, skipped: 0 };
}

async function sweepOneYoutube(watch: WatchRow, run: YoutubeRun): Promise<TargetOutcome> {
  const { now } = run;
  const configRaw = await requireWatchConfigJson(watch.watch_id);
  const config = readWatchConfig(configRaw);
  if (config.status !== "ok") throw new Error(`watch ${watch.watch_id} config_json is unreadable`);

  if (config.pendingChannelId !== null) {
    return verifyPendingYoutube(watch, config.pendingChannelId, run);
  }

  let channelId = config.channelId;
  if (channelId === null) {
    const lookup = await lookupYoutubeChannel(await requireEntityIdentityJson(watch.workspace_id, watch.entity_id));
    switch (lookup.status) {
      case "no-url":
        await flagNoChannel(watch.watch_id, now);
        await markWatchPolled(watch.watch_id, now);
        return { items: 0, stored: 0, unjudged: 0, skipped: 0 };
      case "unresolved":
        await flagLostChannel(watch.watch_id, now);
        await markWatchPolled(watch.watch_id, now);
        return { items: 0, stored: 0, unjudged: 0, skipped: 0 };
    }
    channelId = lookup.channelId;
  }

  const first = await youtubeAdapter({ query: channelId }, null);
  if (first.feedState === "stale") {
    await flagLostChannel(watch.watch_id, now);
    const lookup = await lookupYoutubeChannel(await requireEntityIdentityJson(watch.workspace_id, watch.entity_id));
    if (lookup.status === "id" && lookup.channelId !== channelId) {
      const raw = await requireWatchConfigJson(watch.watch_id);
      await writeWatchConfigJson(watch.watch_id, withPendingChannel(raw, lookup.channelId));
    }
    await markWatchPolled(watch.watch_id, now);
    return { items: 0, stored: 0, unjudged: 0, skipped: 0 };
  }
  if (first.feedState === "ok") {
    return commitYoutubeFeed({ watch, feed: first, run, channelId });
  }
  await markWatchPolled(watch.watch_id, now);
  return { items: 0, stored: 0, unjudged: 0, skipped: 0 };
}

async function sweepYoutubeTarget(
  target: MentionTarget,
  now: string,
  canaryCount: number | null,
): Promise<TargetOutcome> {
  if (adapterFor(target.pluginKey) !== youtubeAdapter) {
    throw new Error(`no mentions adapter for ${target.pluginKey}`);
  }
  let items = 0;
  let stored = 0;
  let unjudged = 0;
  let skipped = 0;
  for (const [index, watch] of target.watches.entries()) {
    try {
      const outcome = await sweepOneYoutube(watch, { now, canaryCount });
      items += outcome.items;
      stored += outcome.stored;
      unjudged += outcome.unjudged;
    } catch (error) {
      if (!isUpstreamTimeout(error)) throw error;
      await markSourceTimedOut(target.sourceId);
      skipped += target.watches.length - index;
      break;
    }
  }
  writeSourcePoint(target.pluginKey, items, canaryCount);
  return { items, stored, unjudged, skipped };
}

async function skipBlockedTarget(target: MentionTarget, status: number): Promise<TargetOutcome> {
  await recordUpstreamBlock(target.sourceId, target.pluginKey, status);
  return { items: 0, stored: 0, unjudged: 0, skipped: target.watches.length };
}

export async function sweepTarget(
  target: MentionTarget,
  now: string,
  canaryCount: number | null,
): Promise<TargetOutcome> {
  try {
    if (target.pluginKey === "youtube.channel_rss") return await sweepYoutubeTarget(target, now, canaryCount);
    const adapter = adapterFor(target.pluginKey);
    if (adapter === undefined) throw new Error(`no mentions adapter for ${target.pluginKey}`);
    const result = await adapter({ query: target.query }, startCursor(target.pluginKey, target.watches));
    writeSourcePoint(target.pluginKey, result.items.length, canaryCount);
    const snapshot = await hashMentionBody(result.rawBody);
    const contexts = new Map<string, DiscoveryContext | null>();
    let stored = 0;
    let unjudged = 0;
    for (const watch of target.watches) {
      if (!contexts.has(watch.workspace_id)) {
        contexts.set(watch.workspace_id, await readDiscoveryContext(watch.workspace_id));
      }
      const context = contexts.get(watch.workspace_id);
      if (context === null || context === undefined) continue;
      const committed = await commitMentionWatch({
        watch,
        context,
        items: result.items,
        snapshot,
        canaryCount,
        now,
      });
      await advanceCursor(target.pluginKey, watch.watch_id, result.items);
      stored += committed.stored;
      unjudged += committed.unjudged;
    }
    return { items: result.items.length, stored, unjudged, skipped: 0 };
  } catch (error) {
    if (error instanceof UpstreamBlockedError) return await skipBlockedTarget(target, error.status);
    if (isUpstreamTimeout(error)) {
      await markSourceTimedOut(target.sourceId);
      return { items: 0, stored: 0, unjudged: 0, skipped: target.watches.length };
    }
    throw error;
  }
}
