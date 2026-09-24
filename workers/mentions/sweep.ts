import { env } from "cloudflare:workers";

import { insertSignalAlert } from "../../app/lib/data/alert.server";
import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { readDiscoveryContext } from "../../app/lib/data/entity.server";
import { insertVerdict } from "../../app/lib/data/jev_verdict.server";
import type { MentionHistoryRow } from "../../app/lib/data/signal.server";
import { collapseMention, insertMention, readRecentMentions, readSeenDedupKeys } from "../../app/lib/data/signal.server";
import { insertWatchSnapshot } from "../../app/lib/data/snapshot.server";
import type { WatchRow } from "../../app/lib/data/watch.server";
import { markWatchPolled, readActiveWatches } from "../../app/lib/data/watch.server";
import type { NoulQuestion, NoulVerdict } from "../../app/lib/jev/client.server";
import { askNoul, JevUnavailableError } from "../../app/lib/jev/client.server";
import { noulAction } from "../../app/lib/jev/thresholds";
import { daysBefore } from "../../app/lib/site-changes.server";
import {
  appendSighting,
  canonicalAfterCollapse,
  normalizeTitle,
  packDuplicate,
  sha256Hex,
} from "../jev/context-pack";
import type { MentionItem } from "./map";
import { adapterFor } from "../sources/registry";

const JUDGED_PER_WATCH = 12;
const HISTORY_LIMIT = 10;
const HISTORY_DAYS = 30;

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

const DUPLICATE: NoulQuestion = {
  id: "duplicate_signal",
  instructions:
    "Are `item` and `other` the same event seen twice (the same story syndicated, reposted, or crawled again), rather than two different events about `subject`?",
  whenTrue: "They report the same event, even if the headline or the URL differs.",
  whenFalse: "They are different events.",
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

function actionReason(questionId: string, p: number): string {
  const action = noulAction(p);
  if (questionId === "duplicate_signal") return action === "act" ? "collapse" : "keep separate";
  if (questionId === "mention_matters") {
    if (action === "reject") return "show all";
    return "feed";
  }
  if (action === "reject") return "drop";
  if (action === "maybe") return "keep, possibly";
  return "keep";
}

function mergeHistory(
  pending: readonly MentionHistoryRow[],
  stored: readonly MentionHistoryRow[],
): MentionHistoryRow[] {
  const byId = new Map<string, MentionHistoryRow>();
  for (const row of pending) byId.set(row.id, row);
  for (const row of stored) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()].slice(0, HISTORY_LIMIT);
}

function remembered(pending: readonly MentionHistoryRow[], row: MentionHistoryRow): MentionHistoryRow[] {
  const index = pending.findIndex((entry) => entry.id === row.id);
  if (index < 0) return [row, ...pending];
  return pending.map((entry, i) => (i === index ? row : entry));
}

function verdictStatement(watch: WatchRow, verdict: NoulVerdict, signalId: string | null, now: string) {
  return insertVerdict({
    workspaceId: watch.workspace_id,
    questionId: verdict.questionId,
    inputHash: verdict.inputHash,
    signalId,
    entityId: watch.entity_id,
    p: verdict.p,
    choice: null,
    reason: actionReason(verdict.questionId, verdict.p),
    decidedAt: now,
  });
}

async function judgeDuplicate(
  watch: WatchRow,
  item: MentionItem,
  hashes: { urlHash: string; titleHash: string },
  history: readonly MentionHistoryRow[],
): Promise<{ match: MentionHistoryRow | null; verdicts: NoulVerdict[] }> {
  const exact = history.find((row) => row.url_hash === hashes.urlHash);
  if (exact !== undefined) return { match: exact, verdicts: [] };
  const verdicts: NoulVerdict[] = [];
  const subject = subjectOf(watch);
  for (const row of history) {
    const verdict = await askNoul(
      watch.workspace_id,
      DUPLICATE,
      packDuplicate({
        subject,
        item: {
          title: item.title,
          publisher: item.publisher ?? null,
          url: item.url,
          published_at: item.publishedAt,
          reliability: watch.reliability,
          url_hash: hashes.urlHash,
          title_hash: hashes.titleHash,
        },
        other: {
          id: row.id,
          kind: "mention",
          title: row.title ?? "",
          url: row.canonical_url,
          date: row.observed_at,
          url_hash: row.url_hash,
          title_hash: await sha256Hex(normalizeTitle(row.title ?? "")),
        },
      }),
    );
    verdicts.push(verdict);
    if (noulAction(verdict.p) === "act") return { match: row, verdicts };
  }
  return { match: null, verdicts };
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
  let pending: MentionHistoryRow[] = [];
  const since = daysBefore(new Date(now), HISTORY_DAYS);
  const subject = subjectOf(watch);
  for (const [index, { item, dedupKey }] of fresh.entries()) {
    let about: NoulVerdict;
    let duplicate: { match: MentionHistoryRow | null; verdicts: NoulVerdict[] } | null = null;
    let matters: NoulVerdict | null = null;
    let hashes: { urlHash: string; titleHash: string } | null = null;
    try {
      about = await askNoul(watch.workspace_id, ABOUT_BRAND, {
        subject,
        item: itemOf(item, watch.reliability),
      });
      if (noulAction(about.p) !== "reject") {
        hashes = {
          urlHash: await sha256Hex(item.url),
          titleHash: await sha256Hex(normalizeTitle(item.title)),
        };
        const history = mergeHistory(pending, await readRecentMentions(watch.entity_id, since, HISTORY_LIMIT));
        if (history.length > 0) duplicate = await judgeDuplicate(watch, item, hashes, history);
        if ((duplicate?.match ?? null) === null) {
          matters = await askNoul(watch.workspace_id, MATTERS, {
            self: { name: context.self.name, domain: context.self.domain, description: context.self.description },
            subject,
            competitor_set: context.competitors,
            item: itemOf(item, watch.reliability),
          });
        }
      }
    } catch (error) {
      if (!(error instanceof JevUnavailableError)) throw error;
      unjudged = fresh.length - index;
      console.error(JSON.stringify({ event: "mentions.jev_unavailable", message: error.message }));
      break;
    }
    if (noulAction(about.p) === "reject") {
      statements.push(verdictStatement(watch, about, null, now));
      continue;
    }
    const match = duplicate?.match ?? null;
    if (match !== null) {
      const nextUrl = canonicalAfterCollapse(match.canonical_url, item.url);
      const nextHash = nextUrl === match.canonical_url ? match.url_hash : await sha256Hex(nextUrl);
      const engagement = appendSighting(match.engagement_json, {
        source_id: watch.source_id,
        url: item.url,
        title: item.title,
        seen_at: now,
      });
      statements.push(
        verdictStatement(watch, about, match.id, now),
        ...(duplicate?.verdicts ?? []).map((verdict) => verdictStatement(watch, verdict, match.id, now)),
        collapseMention({
          id: match.id,
          lastSeenAt: now,
          engagementJson: engagement,
          canonicalUrl: nextUrl,
          urlHash: nextHash,
        }),
      );
      pending = remembered(pending, {
        ...match,
        canonical_url: nextUrl,
        url_hash: nextHash,
        engagement_json: engagement,
      });
      continue;
    }
    if (hashes === null || matters === null) {
      throw new Error("kept mention missing its judgment");
    }
    const signalId = `sig-${(await sha256Hex(`${watch.source_id}:${dedupKey}`)).slice(0, 32)}`;
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
        urlHash: hashes.urlHash,
        publisher: item.publisher ?? null,
        dedupKey,
        publishedAt: item.publishedAt,
        observedAt: now,
        isNotAboutBrand: false,
      }),
      verdictStatement(watch, about, signalId, now),
      ...(duplicate?.verdicts ?? []).map((verdict) => verdictStatement(watch, verdict, signalId, now)),
      verdictStatement(watch, matters, signalId, now),
    );
    if (noulAction(matters.p) === "act") {
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
    pending = remembered(pending, {
      id: signalId,
      title: item.title,
      canonical_url: item.url,
      url_hash: hashes.urlHash,
      observed_at: now,
      engagement_json: null,
    });
    stored += 1;
  }
  return { statements, stored, unjudged };
}

export async function sweepTarget(target: MentionTarget, now: string): Promise<TargetOutcome> {
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
