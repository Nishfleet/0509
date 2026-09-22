import { askNoul } from "../jev/client";
import {
  buildContextPack,
  inputHash,
  titleHashFor,
  type ContextPack,
  type QuestionId,
} from "../jev/context-pack";
import { adapterFor } from "../sources/registry";
import type { MentionItem } from "../sources/mentions/types";
import {
  addSighting,
  d5Action,
  d6Action,
  d8Collapses,
  isReliability,
  pickSurvivor,
  readPayload,
  sha256Hex,
  upgradedCanonical,
  type MentionPayload,
  type Reliability,
  type SurvivorRow,
} from "./map";

const DAY_BUDGET = 25;

interface JudgeEnv {
  DB: D1Database;
  MENTIONS_BODY: { get(key: string): Promise<{ text(): Promise<string> } | null> };
  TYPESAFE_API_KEY?: string;
}

interface SnapshotContext {
  snapshotId: string;
  watchId: string;
  sourceId: string;
  entityId: string;
  workspaceId: string;
  pluginKey: string;
  reliability: Reliability;
  fetchedAt: string;
  payloadR2Key: string | null;
}

type StoredSignal = SurvivorRow & {
  urlHash: string;
  dedupKey: string;
  engagementJson: string | null;
  payloadJson: string;
  titleHash: string | null;
  pluginKey: string;
};

async function loadSnapshot(db: D1Database, snapshotId: string): Promise<SnapshotContext | null> {
  const row = await db
    .prepare(
      `SELECT snapshot.id AS snapshot_id, snapshot.watch_id, snapshot.payload_r2_key, snapshot.fetched_at,
              watch.entity_id, watch.source_id, entity.workspace_id, source.plugin_key, source.reliability
       FROM snapshot
       JOIN watch ON watch.id = snapshot.watch_id
       JOIN entity ON entity.id = watch.entity_id
       JOIN source ON source.id = watch.source_id
       WHERE snapshot.id = ?`,
    )
    .bind(snapshotId)
    .first<{
      snapshot_id: string;
      watch_id: string;
      payload_r2_key: string | null;
      fetched_at: string;
      entity_id: string;
      source_id: string;
      workspace_id: string;
      plugin_key: string;
      reliability: string;
    }>();
  if (!row || !isReliability(row.reliability) || !row.payload_r2_key) return null;
  return {
    snapshotId: row.snapshot_id,
    watchId: row.watch_id,
    sourceId: row.source_id,
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    pluginKey: row.plugin_key,
    reliability: row.reliability,
    fetchedAt: row.fetched_at,
    payloadR2Key: row.payload_r2_key,
  };
}

async function callsToday(db: D1Database, entityId: string, questionId: QuestionId, day: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM jev_verdict WHERE entity_id = ? AND question_id = ? AND decided_at >= ?",
    )
    .bind(entityId, questionId, `${day}T00:00:00.000Z`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function readVerdict(db: D1Database, questionId: QuestionId, hash: string): Promise<{ id: string; p: number } | null> {
  const row = await db
    .prepare("SELECT id, p FROM jev_verdict WHERE question_id = ? AND input_hash = ?")
    .bind(questionId, hash)
    .first<{ id: string; p: number | null }>();
  if (row?.p == null) return null;
  return { id: row.id, p: row.p };
}

async function writeVerdict(
  db: D1Database,
  input: {
    workspaceId: string;
    questionId: QuestionId;
    hash: string;
    signalId: string | null;
    entityId: string;
    p: number;
    reason: string;
    decidedAt: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO jev_verdict
           (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.workspaceId,
        input.questionId,
        input.hash,
        input.signalId,
        input.entityId,
        input.p,
        input.reason,
        input.decidedAt,
      )
      .run();
    return id;
  } catch {
    const existing = await readVerdict(db, input.questionId, input.hash);
    if (existing) return existing.id;
    throw new Error(`jev_verdict insert failed for ${input.questionId}`);
  }
}

async function probability(
  env: JudgeEnv,
  db: D1Database,
  input: {
    pack: ContextPack;
    questionId: QuestionId;
    workspaceId: string;
    entityId: string;
    signalId: string | null;
    reason: string;
    decidedAt: string;
  },
): Promise<{ id: string; p: number }> {
  const hash = await inputHash(input.questionId, input.pack);
  const cached = await readVerdict(db, input.questionId, hash);
  if (cached) return cached;
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured");
  const p = await askNoul(apiKey, input.pack, input.questionId);
  const id = await writeVerdict(db, { ...input, hash, p });
  return { id, p };
}

async function historySignals(db: D1Database, entityId: string, since: string): Promise<StoredSignal[]> {
  const listed = await db
    .prepare(
      `SELECT signal.id, signal.canonical_url, signal.url_hash, signal.observed_at, signal.dedup_key,
              signal.engagement_json, signal.payload_json, source.reliability, source.plugin_key
       FROM signal
       JOIN source ON source.id = signal.source_id
       WHERE signal.entity_id = ? AND signal.kind = 'mention' AND signal.is_tombstoned = 0
         AND signal.observed_at >= ?`,
    )
    .bind(entityId, since)
    .all<{
      id: string;
      canonical_url: string | null;
      url_hash: string | null;
      observed_at: string;
      dedup_key: string;
      engagement_json: string | null;
      payload_json: string;
      reliability: string;
      plugin_key: string;
    }>();
  const rows: StoredSignal[] = [];
  for (const row of listed.results ?? []) {
    if (!row.canonical_url || !row.url_hash || !isReliability(row.reliability)) continue;
    rows.push({
      id: row.id,
      observedAt: row.observed_at,
      reliability: row.reliability,
      canonicalUrl: row.canonical_url,
      urlHash: row.url_hash,
      dedupKey: row.dedup_key,
      engagementJson: row.engagement_json,
      payloadJson: row.payload_json,
      titleHash: readPayload(row.payload_json).titleHash ?? null,
      pluginKey: row.plugin_key,
    });
  }
  return rows;
}

function payloadJson(payload: MentionPayload): string {
  return JSON.stringify(payload);
}

async function saveSignal(
  db: D1Database,
  input: {
    id: string;
    exists: boolean;
    ctx: SnapshotContext;
    item: MentionItem;
    urlHash: string;
    payload: MentionPayload;
    engagementJson: string;
  },
): Promise<void> {
  if (input.exists) {
    await db
      .prepare(
        `UPDATE signal
         SET title = ?, summary = ?, url = ?, canonical_url = ?, url_hash = ?, author = ?,
             engagement_json = ?, payload_json = ?, published_at = ?, last_seen_at = ?, snapshot_id = ?
         WHERE id = ?`,
      )
      .bind(
        input.item.title,
        input.item.bodyExcerpt,
        input.item.canonicalUrl,
        input.item.canonicalUrl,
        input.urlHash,
        input.item.author,
        input.engagementJson,
        payloadJson(input.payload),
        input.item.publishedAt,
        input.ctx.fetchedAt,
        input.ctx.snapshotId,
        input.id,
      )
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO signal (
         id, workspace_id, entity_id, source_id, watch_id, snapshot_id, kind, title, summary,
         url, canonical_url, url_hash, author, engagement_json, payload_json, dedup_key,
         published_at, observed_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'mention', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.ctx.workspaceId,
      input.ctx.entityId,
      input.ctx.sourceId,
      input.ctx.watchId,
      input.ctx.snapshotId,
      input.item.title,
      input.item.bodyExcerpt,
      input.item.canonicalUrl,
      input.item.canonicalUrl,
      input.urlHash,
      input.item.author,
      input.engagementJson,
      payloadJson(input.payload),
      input.item.dedupKey,
      input.item.publishedAt,
      input.ctx.fetchedAt,
      input.ctx.fetchedAt,
    )
    .run();
}

export async function listDedupKeys(env: JudgeEnv, snapshotId: string): Promise<string[]> {
  const ctx = await loadSnapshot(env.DB, snapshotId);
  if (!ctx?.payloadR2Key) return [];
  const object = await env.MENTIONS_BODY.get(ctx.payloadR2Key);
  if (!object) return [];
  const adapter = adapterFor(ctx.pluginKey);
  if (!adapter) return [];
  const items = await adapter.parse(await object.text());
  return items.map((item) => item.dedupKey);
}

export async function judgeBatch(
  env: JudgeEnv,
  snapshotId: string,
  dedupKeys: readonly string[],
): Promise<{ verdictIds: string[]; signalIds: string[] }> {
  const verdictIds: string[] = [];
  const signalIds: string[] = [];
  const ctx = await loadSnapshot(env.DB, snapshotId);
  if (!ctx?.payloadR2Key) return { verdictIds, signalIds };
  const adapter = adapterFor(ctx.pluginKey);
  const object = await env.MENTIONS_BODY.get(ctx.payloadR2Key);
  if (!adapter || !object) return { verdictIds, signalIds };
  const wanted = new Set(dedupKeys);
  const items = (await adapter.parse(await object.text())).filter((item) => wanted.has(item.dedupKey));
  const day = ctx.fetchedAt.slice(0, 10);
  const since = new Date(Date.parse(ctx.fetchedAt) - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const item of items) {
    const existing = await env.DB
      .prepare(
        "SELECT id, payload_json FROM signal WHERE source_id = ? AND dedup_key = ?",
      )
      .bind(ctx.sourceId, item.dedupKey)
      .first<{ id: string; payload_json: string }>();
    const existingPayload = existing ? readPayload(existing.payload_json) : null;
    if (existing && existingPayload?.unreviewed !== true) continue;

    const d5Count = await callsToday(env.DB, ctx.entityId, "mention_is_about_brand", day);
    const urlHash = await sha256Hex(item.canonicalUrl);
    const titleHash = await titleHashFor(item.title);
    const signalId = existing?.id ?? crypto.randomUUID();
    if (d5Count >= DAY_BUDGET) {
      await saveSignal(env.DB, {
        id: signalId,
        exists: existing !== null,
        ctx,
        item,
        urlHash,
        payload: { publisher: item.publisher, unreviewed: true, titleHash },
        engagementJson: JSON.stringify({ metrics: item.engagement, sightings: [] }),
      });
      signalIds.push(signalId);
      continue;
    }

    const pack = await buildContextPack(env.DB, {
      workspaceId: ctx.workspaceId,
      entityId: ctx.entityId,
      item,
      sourceKey: ctx.pluginKey,
      reliability: ctx.reliability,
      capturedAt: ctx.fetchedAt,
      urlHash,
      titleHash,
    });
    const d5 = await probability(env, env.DB, {
      pack,
      questionId: "mention_is_about_brand",
      workspaceId: ctx.workspaceId,
      entityId: ctx.entityId,
      signalId: null,
      reason: d5Action(0),
      decidedAt: ctx.fetchedAt,
    });
    const d5Decision = d5Action(d5.p);
    await env.DB
      .prepare("UPDATE jev_verdict SET reason = ? WHERE id = ?")
      .bind(d5Decision, d5.id)
      .run();
    verdictIds.push(d5.id);
    if (d5Decision === "drop") {
      if (existing) {
        await env.DB.prepare("DELETE FROM signal WHERE id = ?").bind(existing.id).run();
      }
      continue;
    }

    const prior = (await historySignals(env.DB, ctx.entityId, since)).filter((row) => row.id !== signalId);
    const sameUrl = prior.filter((row) => row.urlHash === urlHash);
    const sameTitle = prior.filter((row) => row.titleHash !== null && row.titleHash === titleHash);
    let collapsedInto: Promise<string> | null = null;
    if (sameUrl.length > 0) {
      collapsedInto = collapse(env.DB, ctx, item, urlHash, titleHash, signalId, existing !== null, sameUrl, d5Decision);
    } else if (sameTitle.length > 0) {
      const d8 = await probability(env, env.DB, {
        pack,
        questionId: "duplicate_signal",
        workspaceId: ctx.workspaceId,
        entityId: ctx.entityId,
        signalId: null,
        reason: "separate",
        decidedAt: ctx.fetchedAt,
      });
      const reason = d8Collapses(d8.p) ? "collapse" : "separate";
      await env.DB.prepare("UPDATE jev_verdict SET reason = ? WHERE id = ?").bind(reason, d8.id).run();
      verdictIds.push(d8.id);
      if (d8Collapses(d8.p)) {
        collapsedInto = collapse(env.DB, ctx, item, urlHash, titleHash, signalId, existing !== null, sameTitle, d5Decision);
      }
    }
    if (collapsedInto !== null) {
      const resolved = await collapsedInto;
      if (resolved) signalIds.push(resolved);
      continue;
    }

    const d6Count = await callsToday(env.DB, ctx.entityId, "mention_matters", day);
    if (d6Count >= DAY_BUDGET) {
      await saveSignal(env.DB, {
        id: signalId,
        exists: existing !== null,
        ctx,
        item,
        urlHash,
        payload: { publisher: item.publisher, d5: d5Decision === "possibly" ? "possibly" : "keep", unreviewed: true, titleHash },
        engagementJson: JSON.stringify({ metrics: item.engagement, sightings: [] }),
      });
      signalIds.push(signalId);
      continue;
    }
    const d6 = await probability(env, env.DB, {
      pack,
      questionId: "mention_matters",
      workspaceId: ctx.workspaceId,
      entityId: ctx.entityId,
      signalId,
      reason: "normal",
      decidedAt: ctx.fetchedAt,
    });
    const d6Decision = d6Action(d6.p);
    await env.DB.prepare("UPDATE jev_verdict SET reason = ?, signal_id = ? WHERE id = ?").bind(d6Decision, signalId, d6.id).run();
    verdictIds.push(d6.id);
    await saveSignal(env.DB, {
      id: signalId,
      exists: existing !== null,
      ctx,
      item,
      urlHash,
      payload: {
        publisher: item.publisher,
        d5: d5Decision === "possibly" ? "possibly" : "keep",
        d6: d6Decision,
        titleHash,
      },
      engagementJson: JSON.stringify({ metrics: item.engagement, sightings: [] }),
    });
    signalIds.push(signalId);
    if (d6Decision === "feed") {
      await env.DB
        .prepare(
          `INSERT INTO alert (id, workspace_id, entity_id, signal_id, kind, severity, title, body, status, created_at)
           VALUES (?, ?, ?, ?, 'mention', 'normal', ?, ?, 'unread', ?)`,
        )
        .bind(
          crypto.randomUUID(),
          ctx.workspaceId,
          ctx.entityId,
          signalId,
          item.title || "Mention",
          item.bodyExcerpt,
          ctx.fetchedAt,
        )
        .run();
    }
  }
  return { verdictIds, signalIds };
}

async function collapse(
  db: D1Database,
  ctx: SnapshotContext,
  item: MentionItem,
  urlHash: string,
  titleHash: string,
  signalId: string,
  exists: boolean,
  candidates: StoredSignal[],
  d5Decision: "keep" | "possibly",
): Promise<string> {
  const incoming: SurvivorRow = {
    id: signalId,
    observedAt: ctx.fetchedAt,
    reliability: ctx.reliability,
    canonicalUrl: item.canonicalUrl,
  };
  const survivor = pickSurvivor([incoming, ...candidates]);
  const loserIsIncoming = survivor.id !== signalId;
  const storedWinner = candidates.find((row) => row.id === survivor.id) ?? null;
  const storedLoser = candidates.find((row) => row.id !== survivor.id) ?? null;
  const counterpartUrl = loserIsIncoming ? item.canonicalUrl : (storedLoser?.canonicalUrl ?? item.canonicalUrl);
  const upgrade = upgradedCanonical(survivor.canonicalUrl, counterpartUrl);
  const survivorEngagement = addSighting(
    storedWinner?.engagementJson ?? null,
    {
      sourceKey: loserIsIncoming ? ctx.pluginKey : (storedLoser?.pluginKey ?? ctx.pluginKey),
      dedupKey: loserIsIncoming ? item.dedupKey : (storedLoser?.dedupKey ?? item.dedupKey),
      at: ctx.fetchedAt,
    },
    item.engagement,
  );
  if (loserIsIncoming) {
    await saveSignal(db, {
      id: signalId,
      exists,
      ctx,
      item,
      urlHash,
      payload: {
        publisher: item.publisher,
        collapsed_into: survivor.id,
        d5: d5Decision === "possibly" ? "possibly" : "keep",
        titleHash,
      },
      engagementJson: JSON.stringify({ metrics: item.engagement, sightings: [] }),
    });
    const nextUrl = upgrade ?? survivor.canonicalUrl;
    const nextHash = upgrade ? await sha256Hex(nextUrl) : undefined;
    if (upgrade && nextHash) {
      await db
        .prepare(
          "UPDATE signal SET canonical_url = ?, url = ?, url_hash = ?, engagement_json = ?, last_seen_at = ? WHERE id = ?",
        )
        .bind(nextUrl, nextUrl, nextHash, survivorEngagement, ctx.fetchedAt, survivor.id)
        .run();
    } else {
      await db
        .prepare("UPDATE signal SET engagement_json = ?, last_seen_at = ? WHERE id = ?")
        .bind(survivorEngagement, ctx.fetchedAt, survivor.id)
        .run();
    }
    return signalId;
  }
  await saveSignal(db, {
    id: signalId,
    exists,
    ctx,
    item: upgrade ? { ...item, canonicalUrl: upgrade } : item,
    urlHash: upgrade ? await sha256Hex(upgrade) : urlHash,
    payload: {
      publisher: item.publisher,
      d5: d5Decision === "possibly" ? "possibly" : "keep",
      titleHash,
    },
    engagementJson: survivorEngagement,
  });
  if (!storedLoser) return signalId;
  const loserPayload = readPayload(storedLoser.payloadJson);
  await db
    .prepare("UPDATE signal SET payload_json = ? WHERE id = ?")
    .bind(JSON.stringify({ ...loserPayload, collapsed_into: signalId }), storedLoser.id)
    .run();
  return signalId;
}
