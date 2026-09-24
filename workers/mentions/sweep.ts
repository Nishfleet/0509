import { env } from "cloudflare:workers";

import { insertSignalAlert } from "../../app/lib/data/alert.server";
import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { readDiscoveryContext, readEntityIdentityJson } from "../../app/lib/data/entity.server";
import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import { insertMention, readSeenDedupKeys } from "../../app/lib/data/signal.server";
import { insertWatchSnapshot } from "../../app/lib/data/snapshot.server";
import type { WatchRow } from "../../app/lib/data/watch.server";
import { markWatchPolled, readActiveWatches, readWatchConfigJson, writeWatchConfigJson } from "../../app/lib/data/watch.server";
import type { NoulQuestion, NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import { noulAction } from "../../app/lib/jev/thresholds";
import type { MentionItem } from "./map";
import {
  channelIdFromIdentity,
  readWatchConfig,
  withChannelId,
  withLostChannel,
  withResolvedChannel,
} from "../../app/lib/mentions/youtube-channel";
import { adapterFor } from "../sources/registry";
import type { MentionsAdapter } from "../sources/mentions/types";

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
  now: string;
}): Promise<{ statements: D1PreparedStatement[]; stored: number; unjudged: number }> {
  const { watch, context, items, snapshot, now } = input;
  const snapshotId = crypto.randomUUID();
  const keyed = items.map((item) => ({ item, dedupKey: `${watch.entity_id}:${item.dedupKey}` }));
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
    }),
  ];
  let stored = 0;
  let unjudged = 0;
  for (const [index, { item, dedupKey }] of fresh.entries()) {
    let verdicts: Awaited<ReturnType<typeof judge>>;
    try {
      verdicts = await judge(watch, context, item);
    } catch (error) {
      if (!(error instanceof JevUnavailableError)) throw error;
      unjudged = fresh.length - index;
      console.error(JSON.stringify({ event: "mentions.jev_unavailable", message: error.message }));
      break;
    }
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
        workspaceId: watch.workspace_id,
        entityId: watch.entity_id,
        sourceId: watch.source_id,
        watchId: watch.watch_id,
        snapshotId,
        title: item.title,
        url: item.url,
        urlHash: await sha256Hex(item.url),
        publisher: item.publisher ?? null,
        dedupKey,
        publishedAt: item.publishedAt,
        observedAt: now,
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

async function commitMentionWatch(input: {
  watch: WatchRow;
  items: readonly MentionItem[];
  rawBody: string;
  pluginKey: string;
  now: string;
}): Promise<{ stored: number; unjudged: number }> {
  const { watch, items, rawBody, pluginKey, now } = input;
  const hash = await sha256Hex(rawBody);
  const r2Key = `snapshot/mentions/${pluginKey}/${hash}`;
  await env.SNAPSHOTS.put(r2Key, rawBody, { httpMetadata: { contentType: "application/octet-stream" } });
  const context = await readDiscoveryContext(watch.workspace_id);
  if (context === null) return { stored: 0, unjudged: 0 };
  const titled = items.filter((item) => item.title.trim() !== "");
  const written = await statementsForWatch({ watch, context, items: titled, snapshot: { r2Key, hash }, now });
  await env.DB.batch(written.statements);
  await markWatchPolled(watch.watch_id, now);
  return { stored: written.stored, unjudged: written.unjudged };
}

async function sweepOneYoutube(
  adapter: MentionsAdapter,
  watch: WatchRow,
  now: string,
): Promise<TargetOutcome> {
  const configRaw = await readWatchConfigJson(watch.watch_id);
  const config = readWatchConfig(configRaw);
  if (config.status !== "ok") throw new Error(`watch ${watch.watch_id} config_json is unreadable`);

  let channelId = config.channelId;
  if (channelId === null) {
    channelId = channelIdFromIdentity(await readEntityIdentityJson(watch.entity_id));
    if (channelId === null) {
      await markWatchPolled(watch.watch_id, now);
      return { items: 0, stored: 0, unjudged: 0 };
    }
    await writeWatchConfigJson(watch.watch_id, withChannelId(configRaw, channelId));
  }

  const first = await adapter({ query: channelId }, null);
  if (first.feedState === "error") {
    await markWatchPolled(watch.watch_id, now);
    return { items: 0, stored: 0, unjudged: 0 };
  }
  if (first.feedState === "stale") {
    const current = await readWatchConfigJson(watch.watch_id);
    const flagged = withLostChannel(current, now);
    if (flagged !== current) await writeWatchConfigJson(watch.watch_id, flagged);
    const candidate = channelIdFromIdentity(await readEntityIdentityJson(watch.entity_id));
    if (candidate !== null && candidate !== channelId) {
      const second = await adapter({ query: candidate }, null);
      if (second.feedState === "ok") {
        await writeWatchConfigJson(watch.watch_id, withResolvedChannel(flagged, candidate));
        const committed = await commitMentionWatch({
          watch,
          items: second.items,
          rawBody: second.rawBody,
          pluginKey: "youtube.channel_rss",
          now,
        });
        return { items: second.items.length, stored: committed.stored, unjudged: committed.unjudged };
      }
    }
    await markWatchPolled(watch.watch_id, now);
    return { items: 0, stored: 0, unjudged: 0 };
  }

  const current = await readWatchConfigJson(watch.watch_id);
  const currentConfig = readWatchConfig(current);
  if (currentConfig.status === "ok" && currentConfig.degraded !== null) {
    await writeWatchConfigJson(watch.watch_id, withResolvedChannel(current, channelId));
  }
  const committed = await commitMentionWatch({
    watch,
    items: first.items,
    rawBody: first.rawBody,
    pluginKey: "youtube.channel_rss",
    now,
  });
  return { items: first.items.length, stored: committed.stored, unjudged: committed.unjudged };
}

async function sweepYoutubeTarget(target: MentionTarget, now: string): Promise<TargetOutcome> {
  const adapter = adapterFor(target.pluginKey);
  if (adapter === undefined) throw new Error(`no mentions adapter for ${target.pluginKey}`);
  let items = 0;
  let stored = 0;
  let unjudged = 0;
  for (const watch of target.watches) {
    const outcome = await sweepOneYoutube(adapter, watch, now);
    items += outcome.items;
    stored += outcome.stored;
    unjudged += outcome.unjudged;
  }
  return { items, stored, unjudged };
}

export async function sweepTarget(target: MentionTarget, now: string): Promise<TargetOutcome> {
  if (target.pluginKey === "youtube.channel_rss") return sweepYoutubeTarget(target, now);
  const adapter = adapterFor(target.pluginKey);
  if (adapter === undefined) throw new Error(`no mentions adapter for ${target.pluginKey}`);
  const result = await adapter({ query: target.query }, null);
  const titled = result.items.filter((item) => item.title.trim() !== "");
  const hash = await sha256Hex(result.rawBody);
  const r2Key = `snapshot/mentions/${target.pluginKey}/${hash}`;
  await env.SNAPSHOTS.put(r2Key, result.rawBody, { httpMetadata: { contentType: "application/octet-stream" } });

  const contexts = new Map<string, DiscoveryContext | null>();
  let stored = 0;
  let unjudged = 0;
  for (const watch of target.watches) {
    if (!contexts.has(watch.workspace_id)) {
      contexts.set(watch.workspace_id, await readDiscoveryContext(watch.workspace_id));
    }
    const context = contexts.get(watch.workspace_id);
    if (context === null || context === undefined) continue;
    const written = await statementsForWatch({ watch, context, items: titled, snapshot: { r2Key, hash }, now });
    await env.DB.batch(written.statements);
    await markWatchPolled(watch.watch_id, now);
    stored += written.stored;
    unjudged += written.unjudged;
  }
  return { items: result.items.length, stored, unjudged };
}
