import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { insertSignalAlert } from "../../app/lib/data/alert.server";
import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { readDiscoveryContext, readEntityIdentityJson } from "../../app/lib/data/entity.server";
import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import { insertMention, readSeenDedupKeys } from "../../app/lib/data/signal.server";
import { insertWatchSnapshot } from "../../app/lib/data/snapshot.server";
import { markSourceBlocked } from "../../app/lib/data/source.server";
import type { WatchRow } from "../../app/lib/data/watch.server";
import { markWatchPolled, readActiveWatches, readWatchConfigJson, writeWatchConfigJson } from "../../app/lib/data/watch.server";
import type { NoulQuestion, NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import { lookupYoutubeChannel } from "../../app/lib/identity/youtube-channel.server";
import { noulAction } from "../../app/lib/jev/thresholds";
import {
  readWatchConfig,
  withLostChannel,
  withPendingChannel,
  withResolvedChannel,
  withoutPendingChannel,
} from "../../app/lib/mentions/youtube-channel";
import { storedDedupKey, toSignalRow, type MentionItem } from "./map";
import { writeSourcePoint } from "./canary";
import { adapterFor } from "../sources/registry";
import { youtubeAdapter } from "../sources/mentions/youtube";
import { UpstreamBlockedError } from "../sources/mentions/types";
import type { OkYoutubeFeed } from "../sources/mentions/youtube";

const JUDGED_PER_WATCH = 12;

export const PACED_PLUGINS: ReadonlySet<string> = new Set(["gdelt.doc"]);

export interface MentionTarget {
  sourceId: string;
  pluginKey: string;
  query: string;
  watches: WatchRow[];
}

export interface TargetOutcome {
  items: number;
  stored: number;
  unjudged: number;
}

const ABOUT_BRAND: NoulQuestion = {
  id: "mention_is_about_brand",
  instructions:
    "Is `item` actually about `subject`, the brand named in `subject.name` with the website `subject.domain`, and not a different company, product, person or word that shares the name?",
  whenTrue: "The headline is about this brand or its products, people or business.",
  whenFalse: "It is about something else that shares or resembles the name.",
};

const MATTERS: NoulQuestion = {
  id: "mention_matters",
  instructions:
    "Would the owner of `self` want to know about this mention of `subject` this week? It matters when it shows a move: a launch, a price or offer change, funding, a deal, a hire or exit at the top, an expansion, a campaign, a controversy or a big review.",
  whenTrue: "It reports a move or an event a competitor-watcher would act on or bring up.",
  whenFalse: "It is a passing mention, a listicle entry, a stock ticker line, or old news retold.",
};

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
      watches: [...(existing?.watches ?? []), watch],
    });
  }
  return [...byTarget.values()];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function subjectOf(watch: WatchRow) {
  return { name: watch.name, domain: watch.domain, role: watch.role };
}

function itemOf(item: MentionItem, reliability: string) {
  return {
    title: item.title,
    publisher: item.publisher ?? null,
    url: item.url,
    published_at: item.publishedAt,
    reliability,
  };
}

async function judge(
  watch: WatchRow,
  context: DiscoveryContext,
  item: MentionItem,
): Promise<{ about: NoulVerdict; matters: NoulVerdict | null }> {
  const subject = subjectOf(watch);
  const about = await askNoul(watch.workspace_id, ABOUT_BRAND, {
    subject,
    item: itemOf(item, watch.reliability),
  });
  if (noulAction(about.p) === "reject") return { about, matters: null };
  const matters = await askNoul(watch.workspace_id, MATTERS, {
    self: { name: context.self.name, domain: context.self.domain, description: context.self.description },
    subject,
    competitor_set: context.competitors,
    item: itemOf(item, watch.reliability),
  });
  return { about, matters };
}

async function statementsForWatch(input: {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshot: { r2Key: string; hash: string };
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
  const fresh = keyed.filter((entry) => !seen.has(entry.dedupKey)).slice(0, JUDGED_PER_WATCH);
  const statements: D1PreparedStatement[] = [
    insertWatchSnapshot({
      id: snapshotId,
      watchId: watch.watch_id,
      fetchedAt: now,
      r2Key: snapshot.r2Key,
      hash: snapshot.hash,
      itemCount: items.length,
      canaryCount,
    }),
  ];
  let stored = 0;
  let unjudged = 0;
  for (const [index, { item }] of fresh.entries()) {
    let verdicts: Awaited<ReturnType<typeof judge>>;
    try {
      verdicts = await judge(watch, context, item);
    } catch (error) {
      if (!(error instanceof JevUnavailableError)) throw error;
      unjudged = fresh.length - index;
      console.error(JSON.stringify({ event: "mentions.jev_unavailable", message: error.message }));
      break;
    }
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
    const rejected = noulAction(verdicts.about.p) === "reject";
    const verdictRow = (verdict: NoulVerdict) =>
      insertVerdict({
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
    statements.push(
      insertMention({
        id: signalId,
        workspaceId: mapped.workspace_id,
        entityId: mapped.entity_id,
        sourceId: mapped.source_id,
        watchId: watch.watch_id,
        snapshotId,
        title: mapped.title,
        url: mapped.canonical_url,
        urlHash: mapped.url_hash,
        author: mapped.author,
        engagementJson: mapped.engagement_json,
        payloadJson: mapped.payload_json,
        dedupKey,
        publishedAt: mapped.published_at,
        observedAt: mapped.observed_at,
        isNotAboutBrand: rejected,
      }),
      verdictRow(verdicts.about),
    );
    if (rejected) continue;
    if (verdicts.matters !== null) statements.push(verdictRow(verdicts.matters));
    if (verdicts.matters !== null && noulAction(verdicts.matters.p) === "act") {
      statements.push(
        insertSignalAlert(env.DB, {
          workspaceId: watch.workspace_id,
          entityId: watch.entity_id,
          signalId,
          kind: "mention",
          title: `${watch.name}: ${item.title}`,
          body: item.publisher ?? null,
          createdAt: now,
        }),
      );
    }
    stored += 1;
  }
  return { statements, stored, unjudged };
}

async function putMentionBody(
  pluginKey: string,
  rawBody: string,
): Promise<{ r2Key: string; hash: string }> {
  const hash = await sha256Hex(rawBody);
  const r2Key = `snapshot/mentions/${pluginKey}/${hash}`;
  await env.SNAPSHOTS.put(r2Key, rawBody, { httpMetadata: { contentType: "application/octet-stream" } });
  return { r2Key, hash };
}

async function commitMentionWatch(input: {
  watch: WatchRow;
  context: DiscoveryContext;
  items: readonly MentionItem[];
  snapshot: { r2Key: string; hash: string };
  canaryCount: number | null;
  now: string;
}): Promise<{ stored: number; unjudged: number }> {
  const { watch, context, items, snapshot, canaryCount, now } = input;
  const titled = items.filter((item) => item.title.trim() !== "");
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

async function requireEntityIdentityJson(entityId: string): Promise<string> {
  const raw = await readEntityIdentityJson(entityId);
  if (raw === null) throw new Error(`entity ${entityId} is missing`);
  return raw;
}

async function flagLostChannel(watchId: string, now: string): Promise<void> {
  const current = await requireWatchConfigJson(watchId);
  const flagged = withLostChannel(current, now);
  if (flagged !== current) await writeWatchConfigJson(watchId, flagged);
}

async function commitYoutubeFeed(
  watch: WatchRow,
  feed: OkYoutubeFeed,
  pluginKey: string,
  canaryCount: number | null,
  now: string,
  channelId: string,
): Promise<TargetOutcome> {
  const current = await requireWatchConfigJson(watch.watch_id);
  const currentConfig = readWatchConfig(current);
  if (
    currentConfig.status === "ok" &&
    (currentConfig.channelId !== channelId ||
      currentConfig.degraded !== null ||
      currentConfig.pendingChannelId !== null)
  ) {
    await writeWatchConfigJson(watch.watch_id, withResolvedChannel(current, channelId));
  }
  const snapshot = await putMentionBody(pluginKey, feed.rawBody);
  const context = await readDiscoveryContext(watch.workspace_id);
  if (context === null) return { items: feed.items.length, stored: 0, unjudged: 0 };
  const committed = await commitMentionWatch({
    watch,
    context,
    items: feed.items,
    snapshot,
    canaryCount,
    now,
  });
  return { items: feed.items.length, stored: committed.stored, unjudged: committed.unjudged };
}

async function verifyPendingYoutube(
  watch: WatchRow,
  pendingId: string,
  pluginKey: string,
  now: string,
  canaryCount: number | null,
): Promise<TargetOutcome> {
  const result = await youtubeAdapter({ query: pendingId }, null);
  if (result.feedState === "ok") {
    return commitYoutubeFeed(watch, result, pluginKey, canaryCount, now, pendingId);
  }
  if (result.feedState === "stale") {
    const current = await requireWatchConfigJson(watch.watch_id);
    const flagged = withLostChannel(withoutPendingChannel(current), now);
    await writeWatchConfigJson(watch.watch_id, flagged);
  }
  await markWatchPolled(watch.watch_id, now);
  return { items: 0, stored: 0, unjudged: 0 };
}

async function sweepOneYoutube(
  watch: WatchRow,
  pluginKey: string,
  now: string,
  canaryCount: number | null,
): Promise<TargetOutcome> {
  const configRaw = await requireWatchConfigJson(watch.watch_id);
  const config = readWatchConfig(configRaw);
  if (config.status !== "ok") throw new Error(`watch ${watch.watch_id} config_json is unreadable`);

  if (config.pendingChannelId !== null) {
    return verifyPendingYoutube(watch, config.pendingChannelId, pluginKey, now, canaryCount);
  }

  let channelId = config.channelId;
  if (channelId === null) {
    const lookup = await lookupYoutubeChannel(await requireEntityIdentityJson(watch.entity_id));
    if (lookup.status !== "id") {
      if (lookup.status === "unresolved") await flagLostChannel(watch.watch_id, now);
      await markWatchPolled(watch.watch_id, now);
      return { items: 0, stored: 0, unjudged: 0 };
    }
    channelId = lookup.channelId;
  }

  const first = await youtubeAdapter({ query: channelId }, null);
  if (first.feedState === "stale") {
    await flagLostChannel(watch.watch_id, now);
    const lookup = await lookupYoutubeChannel(await requireEntityIdentityJson(watch.entity_id));
    if (lookup.status === "id" && lookup.channelId !== channelId) {
      const raw = await requireWatchConfigJson(watch.watch_id);
      await writeWatchConfigJson(watch.watch_id, withPendingChannel(raw, lookup.channelId));
    }
    await markWatchPolled(watch.watch_id, now);
    return { items: 0, stored: 0, unjudged: 0 };
  }
  if (first.feedState === "ok") {
    return commitYoutubeFeed(watch, first, pluginKey, canaryCount, now, channelId);
  }
  await markWatchPolled(watch.watch_id, now);
  return { items: 0, stored: 0, unjudged: 0 };
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
  for (const watch of target.watches) {
    const outcome = await sweepOneYoutube(watch, target.pluginKey, now, canaryCount);
    items += outcome.items;
    stored += outcome.stored;
    unjudged += outcome.unjudged;
  }
  writeSourcePoint(target.pluginKey, items, canaryCount);
  return { items, stored, unjudged };
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
    const result = await adapter({ query: target.query }, null);
    writeSourcePoint(target.pluginKey, result.items.length, canaryCount);
    const snapshot = await putMentionBody(target.pluginKey, result.rawBody);
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
      stored += committed.stored;
      unjudged += committed.unjudged;
    }
    return { items: result.items.length, stored, unjudged };
  } catch (error) {
    if (error instanceof UpstreamBlockedError) {
      await markSourceBlocked(target.sourceId, error.status);
      throw new NonRetryableError(error.message, "UpstreamBlockedError");
    }
    throw error;
  }
}
