import { env } from "cloudflare:workers";

import { insertSignalAlert } from "../../app/lib/data/alert.server";
import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { readDiscoveryContext } from "../../app/lib/data/entity.server";
import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import { insertMention, readSeenDedupKeys } from "../../app/lib/data/signal.server";
import { insertWatchSnapshot } from "../../app/lib/data/snapshot.server";
import type { WatchRow } from "../../app/lib/data/watch.server";
import { markWatchPolled, readActiveWatches } from "../../app/lib/data/watch.server";
import type { NoulQuestion, NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import { noulAction } from "../../app/lib/jev/thresholds";
import { storedDedupKey, toSignalRow, type MentionItem } from "./map";
import { writeSourcePoint } from "./canary";
import { adapterFor } from "../sources/registry";

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

export async function sweepTarget(
  target: MentionTarget,
  now: string,
  canaryCount: number | null,
): Promise<TargetOutcome> {
  const adapter = adapterFor(target.pluginKey);
  if (adapter === undefined) throw new Error(`no mentions adapter for ${target.pluginKey}`);
  const result = await adapter({ query: target.query }, null);
  writeSourcePoint(target.pluginKey, result.items.length, canaryCount);
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
    const written = await statementsForWatch({
      watch,
      context,
      items: titled,
      snapshot: { r2Key, hash },
      canaryCount,
      now,
    });
    await env.DB.batch(written.statements);
    await markWatchPolled(watch.watch_id, now);
    stored += written.stored;
    unjudged += written.unjudged;
  }
  return { items: result.items.length, stored, unjudged };
}
