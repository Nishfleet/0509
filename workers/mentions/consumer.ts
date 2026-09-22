import { loadSourceConfig, runCanary } from "./canary";
import { adapterFor, targetFromWatch } from "../sources/registry";
import { UpstreamStatus } from "../sources/mentions/types";
import {
  r2Key,
  readSourceConfig,
  sha256Hex,
  snapshotPlan,
  type MentionMessage,
} from "./map";

export interface ConsumerEnv {
  DB: D1Database;
  MENTIONS_BODY: {
    put(key: string, value: string): Promise<unknown>;
  };
  MENTIONS_JUDGE: {
    create(options: { params: { snapshotId: string } }): Promise<unknown>;
  };
  MENTIONS_ANALYTICS?: {
    writeDataPoint(event: { indexes: string[]; blobs: string[]; doubles: number[] }): void;
  };
}

interface WatchRow {
  target_key: string;
  cursor: string | null;
  plugin_key: string;
  is_enabled: number;
  config_json: string;
  state: string;
  kind: string;
}

async function hasUnreviewed(db: D1Database, watchId: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM signal WHERE watch_id = ? AND json_extract(payload_json, '$.unreviewed') = 1 LIMIT 1",
    )
    .bind(watchId)
    .first<{ id: string }>();
  return row !== null;
}

export async function consumeMention(env: ConsumerEnv, message: MentionMessage, now = new Date()): Promise<void> {
  const watch = await env.DB
    .prepare(
      `SELECT watch.target_key, watch.cursor, source.plugin_key, source.is_enabled, source.config_json,
              entity.state, source.kind
       FROM watch
       JOIN source ON source.id = watch.source_id
       JOIN entity ON entity.id = watch.entity_id
       WHERE watch.id = ?`,
    )
    .bind(message.watchId)
    .first<WatchRow>();
  if (!watch) return;
  if (watch.state !== "on" || watch.kind !== "mentions" || watch.is_enabled !== 1) return;
  const loaded = await loadSourceConfig(env.DB, message.sourceId);
  const config = loaded?.config ?? readSourceConfig(watch.config_json);
  const afterCanary = await runCanary(env.DB, message.sourceId, watch.plugin_key, config, now);
  const adapter = adapterFor(watch.plugin_key);
  if (!adapter) throw new UpstreamStatus(watch.plugin_key, 404);
  const polled = await adapter.poll(targetFromWatch(watch.plugin_key, watch.target_key), watch.cursor);
  const payloadHash = await sha256Hex(polled.rawBody);
  const previous = await env.DB
    .prepare(
      "SELECT payload_hash, payload_r2_key FROM snapshot WHERE watch_id = ? ORDER BY fetched_at DESC LIMIT 1",
    )
    .bind(message.watchId)
    .first<{ payload_hash: string; payload_r2_key: string | null }>();
  const day = now.toISOString().slice(0, 10);
  const today = await env.DB
    .prepare("SELECT id FROM snapshot WHERE watch_id = ? AND fetched_at >= ? LIMIT 1")
    .bind(message.watchId, `${day}T00:00:00.000Z`)
    .first<{ id: string }>();
  const unreviewed = await hasUnreviewed(env.DB, message.watchId);
  const plan = snapshotPlan({
    previousHash: previous?.payload_hash ?? null,
    nextHash: payloadHash,
    hasUnreviewed: unreviewed,
    alreadyToday: today !== null,
  });
  const reusedKey = plan.reuseKey ? previous?.payload_r2_key ?? null : null;
  const key = reusedKey ?? r2Key(message.workspaceId, message.watchId, now.toISOString(), payloadHash);
  if (!plan.reuseKey) await env.MENTIONS_BODY.put(key, polled.rawBody);
  let snapshotId = today?.id ?? null;
  if (plan.writeRow) {
    snapshotId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(snapshotId, message.watchId, now.toISOString(), key, payloadHash, polled.items.length)
      .run();
    await env.DB
      .prepare("UPDATE watch SET last_polled_at = ? WHERE id = ?")
      .bind(now.toISOString(), message.watchId)
      .run();
  }
  env.MENTIONS_ANALYTICS?.writeDataPoint({
    indexes: [watch.plugin_key],
    blobs: [watch.plugin_key],
    doubles: [polled.items.length, afterCanary.lastCanaryCount ?? 0],
  });
  if (plan.judge && snapshotId) {
    await env.MENTIONS_JUDGE.create({ params: { snapshotId } });
  }
}

export async function markMentionDlq(env: ConsumerEnv, message: MentionMessage, now = new Date()): Promise<void> {
  const row = await env.DB
    .prepare("SELECT plugin_key, config_json FROM source WHERE id = ?")
    .bind(message.sourceId)
    .first<{ plugin_key: string; config_json: string }>();
  if (!row) return;
  const config = readSourceConfig(row.config_json);
  const reason =
    row.plugin_key === "youtube.channel_rss" ? "we lost the channel, re-resolving" : "not answering";
  const next = {
    ...config,
    approved_cost: null,
    degradedSince: config.degradedSince ?? now.toISOString(),
    degradedReason: reason,
  };
  await env.DB.prepare("UPDATE source SET config_json = ? WHERE id = ?").bind(JSON.stringify(next), message.sourceId).run();
}

export function isMentionMessage(value: unknown): value is MentionMessage {
  if (!value || typeof value !== "object") return false;
  return (
    "watchId" in value &&
    "sourceId" in value &&
    "entityId" in value &&
    "workspaceId" in value &&
    typeof value.watchId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.entityId === "string" &&
    typeof value.workspaceId === "string"
  );
}
