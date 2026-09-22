import {
  AdsDescriptorError,
  parseAdsDescriptor,
  type AdsSourceDescriptor,
} from "../app/lib/ads/descriptor";
import { snapshotInsert } from "../app/lib/data/snapshot.server";
import { watchConfigUpdate } from "../app/lib/data/watch.server";
import { AdsTransportAuthError } from "../app/lib/ads/transport-api";
import { PAGE_SWEEP_MAX_CONCURRENCY, SWEEP_BATCH_LIMIT } from "./ads-cap";

export interface SweepWatch {
  watchId: string;
  sourceId: string;
  targetKey: string;
  transport: "api" | "browser";
  platform: string;
}

export interface InvalidSweepWatch {
  watchId: string;
  sourceId: string;
}

export interface SweepSelection {
  watches: SweepWatch[];
  invalid: InvalidSweepWatch[];
}

export interface SweepMessage {
  watchId: string;
  tick: string;
  round: 0 | 1;
}

export interface SweepQueue {
  sendBatch(messages: Iterable<{ body: SweepMessage }>): Promise<unknown>;
}

export type SweepPull = (
  descriptor: AdsSourceDescriptor,
  target: string,
) => Promise<{ payload: unknown; status: number }>;

export type SweepOutcome = "ack" | "retry";

interface SweepState {
  last_miss_tick?: string;
  degraded_at?: string;
  measured_ms?: number;
  coverage_short?: number;
  blocked_status?: number;
  dead_letter_queue?: string;
  dead_letter_id?: string;
  dead_letter_tick?: string;
}

const SELECT_SQL = `
  SELECT w.id AS watch_id, w.target_key, s.id AS source_id, s.platform, s.config_json
  FROM watch w
  JOIN source s ON s.id = w.source_id
  JOIN entity e ON e.id = w.entity_id
  WHERE e.state = 'on'
    AND s.kind = 'ads'
    AND s.is_enabled = 1
    AND w.is_active = 1
`;

const PRIORITY_PLATFORMS = new Set(["meta", "google"]);
const USD_PER_ADDITIONAL_BROWSER_MONTH = 2;

export function previousTick(tick: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tick);
  if (!match) {
    throw new Error(`tick must be YYYY-MM-DD, got ${tick}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function chunkMessages<T>(items: T[], size = SWEEP_BATCH_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function payloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
}

export async function selectSweepWatches(db: D1Database): Promise<SweepSelection> {
  const rows = await db
    .prepare(SELECT_SQL)
    .all<{
      watch_id: string;
      target_key: string;
      source_id: string;
      platform: string;
      config_json: string;
    }>();
  const watches: SweepWatch[] = [];
  const invalid: InvalidSweepWatch[] = [];
  for (const row of rows.results) {
    try {
      const descriptor = parseAdsDescriptor(row.config_json);
      watches.push({
        watchId: row.watch_id,
        sourceId: row.source_id,
        targetKey: row.target_key,
        transport: descriptor.transport,
        platform: row.platform,
      });
    } catch (err) {
      if (!(err instanceof AdsDescriptorError)) throw err;
      invalid.push({ watchId: row.watch_id, sourceId: row.source_id });
    }
  }
  return { watches, invalid };
}

export async function watchesForIds(
  db: D1Database,
  ids: string[],
): Promise<SweepWatch[]> {
  if (ids.length === 0) return [];
  const want = new Set(ids);
  const { watches } = await selectSweepWatches(db);
  return watches.filter((watch) => want.has(watch.watchId));
}

export async function enqueueSweep(
  watches: SweepWatch[],
  tick: string,
  round: 0 | 1,
  queues: { page: SweepQueue; fetch: SweepQueue },
): Promise<{ page: number; fetch: number }> {
  const page: SweepMessage[] = [];
  const fetchMessages: SweepMessage[] = [];
  const ordered = [...watches].sort(
    (left, right) =>
      Number(!PRIORITY_PLATFORMS.has(left.platform)) -
      Number(!PRIORITY_PLATFORMS.has(right.platform)),
  );
  for (const watch of ordered) {
    const message: SweepMessage = { watchId: watch.watchId, tick, round };
    if (watch.transport === "browser") page.push(message);
    else fetchMessages.push(message);
  }
  for (const chunk of chunkMessages(page)) {
    await queues.page.sendBatch(chunk.map((body) => ({ body })));
  }
  for (const chunk of chunkMessages(fetchMessages)) {
    await queues.fetch.sendBatch(chunk.map((body) => ({ body })));
  }
  return { page: page.length, fetch: fetchMessages.length };
}

async function coveredWatchIds(
  db: D1Database,
  tick: string,
  watchIds: string[],
): Promise<Set<string>> {
  const covered = new Set<string>();
  for (const chunk of chunkMessages(watchIds, 80)) {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT watch_id FROM snapshot WHERE fetched_at = ? AND watch_id IN (${placeholders})`,
      )
      .bind(tick, ...chunk)
      .all<{ watch_id: string }>();
    for (const row of rows.results) covered.add(row.watch_id);
  }
  return covered;
}

export async function assertCoverage(
  db: D1Database,
  watches: SweepWatch[],
  tick: string,
  queues: { page: SweepQueue; fetch: SweepQueue },
): Promise<{ covered: number; retried: number }> {
  const covered = await coveredWatchIds(
    db,
    tick,
    watches.map((watch) => watch.watchId),
  );
  const gap = watches.filter((watch) => !covered.has(watch.watchId));
  if (gap.length > 0) {
    await enqueueSweep(gap, tick, 1, queues);
  }
  return { covered: covered.size, retried: gap.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfig(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return null;
  }
  if (!isRecord(parsed)) return null;
  return parsed;
}

function readSweep(raw: string): SweepState | null {
  const config = readConfig(raw);
  if (config === null) return null;
  const sweep = config.sweep;
  if (sweep === undefined) return {};
  if (!isRecord(sweep)) return null;
  const state: SweepState = {};
  if (typeof sweep.last_miss_tick === "string") state.last_miss_tick = sweep.last_miss_tick;
  if (typeof sweep.degraded_at === "string") state.degraded_at = sweep.degraded_at;
  if (typeof sweep.measured_ms === "number") state.measured_ms = sweep.measured_ms;
  if (typeof sweep.coverage_short === "number") state.coverage_short = sweep.coverage_short;
  if (typeof sweep.blocked_status === "number") state.blocked_status = sweep.blocked_status;
  if (typeof sweep.dead_letter_queue === "string") state.dead_letter_queue = sweep.dead_letter_queue;
  if (typeof sweep.dead_letter_id === "string") state.dead_letter_id = sweep.dead_letter_id;
  if (typeof sweep.dead_letter_tick === "string") state.dead_letter_tick = sweep.dead_letter_tick;
  return state;
}

export function withDeadLetter(
  raw: string,
  queue: string,
  id: string,
  tick: string,
): string | null {
  const prev = readSweep(raw);
  if (prev === null) return null;
  return writeSweep(raw, {
    ...prev,
    dead_letter_queue: queue,
    dead_letter_id: id,
    dead_letter_tick: tick,
  });
}

function writeSweep(raw: string, sweep: SweepState): string | null {
  const base = readConfig(raw);
  if (base === null) return null;
  base.sweep = sweep;
  return JSON.stringify(base);
}

async function loadWatchConfigs(
  db: D1Database,
  watchIds: string[],
): Promise<Map<string, string>> {
  const configs = new Map<string, string>();
  for (const chunk of chunkMessages(watchIds, 80)) {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT id, config_json FROM watch WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ id: string; config_json: string }>();
    for (const row of rows.results) configs.set(row.id, row.config_json);
  }
  return configs;
}

function keptSweep(prev: SweepState): SweepState {
  return {
    ...(prev.last_miss_tick === undefined ? {} : { last_miss_tick: prev.last_miss_tick }),
    ...(prev.degraded_at === undefined ? {} : { degraded_at: prev.degraded_at }),
    ...(prev.measured_ms === undefined ? {} : { measured_ms: prev.measured_ms }),
    ...(prev.coverage_short === undefined ? {} : { coverage_short: prev.coverage_short }),
    ...(prev.blocked_status === undefined ? {} : { blocked_status: prev.blocked_status }),
    ...(prev.dead_letter_queue === undefined ? {} : { dead_letter_queue: prev.dead_letter_queue }),
    ...(prev.dead_letter_id === undefined ? {} : { dead_letter_id: prev.dead_letter_id }),
    ...(prev.dead_letter_tick === undefined ? {} : { dead_letter_tick: prev.dead_letter_tick }),
  };
}

function coveredThisTick(prev: SweepState, measuredMs: number): SweepState {
  const kept = keptSweep(prev);
  return {
    measured_ms: measuredMs,
    ...(kept.degraded_at === undefined ? {} : { degraded_at: kept.degraded_at }),
    ...(kept.blocked_status === undefined ? {} : { blocked_status: kept.blocked_status }),
    ...(kept.coverage_short === undefined ? {} : { coverage_short: kept.coverage_short }),
    ...(kept.dead_letter_queue === undefined ? {} : { dead_letter_queue: kept.dead_letter_queue }),
    ...(kept.dead_letter_id === undefined ? {} : { dead_letter_id: kept.dead_letter_id }),
    ...(kept.dead_letter_tick === undefined ? {} : { dead_letter_tick: kept.dead_letter_tick }),
  };
}

function recoveredPull(prev: SweepState): SweepState {
  return {
    ...(prev.measured_ms === undefined ? {} : { measured_ms: prev.measured_ms }),
    ...(prev.coverage_short === undefined ? {} : { coverage_short: prev.coverage_short }),
    ...(prev.dead_letter_queue === undefined ? {} : { dead_letter_queue: prev.dead_letter_queue }),
    ...(prev.dead_letter_id === undefined ? {} : { dead_letter_id: prev.dead_letter_id }),
    ...(prev.dead_letter_tick === undefined ? {} : { dead_letter_tick: prev.dead_letter_tick }),
  };
}

function queueConfigUpdate(
  db: D1Database,
  updates: D1PreparedStatement[],
  raw: string,
  watchId: string,
  next: SweepState,
): void {
  const written = writeSweep(raw, next);
  if (written === null) return;
  updates.push(watchConfigUpdate(db, watchId, written));
}

export async function escalateCoverage(
  db: D1Database,
  bucket: R2Bucket,
  tick: string,
  watches: SweepWatch[],
  measuredMs: number,
  retried: number,
  invalid: InvalidSweepWatch[] = [],
): Promise<{ degradedSourceIds: string[]; measuredMs: number }> {
  const covered = await coveredWatchIds(
    db,
    tick,
    watches.map((watch) => watch.watchId),
  );
  const missing = watches.filter((watch) => !covered.has(watch.watchId));
  const present = watches.filter((watch) => covered.has(watch.watchId));
  const configs = await loadWatchConfigs(db, [
    ...watches.map((watch) => watch.watchId),
    ...invalid.map((watch) => watch.watchId),
  ]);
  const updates: D1PreparedStatement[] = [];
  const degradedSourceIds: string[] = [];
  const yesterday = previousTick(tick);

  for (const watch of missing) {
    const raw = configs.get(watch.watchId);
    if (raw === undefined) {
      degradedSourceIds.push(watch.sourceId);
      continue;
    }
    const prev = readSweep(raw);
    if (prev === null) {
      degradedSourceIds.push(watch.sourceId);
      continue;
    }
    const degraded = prev.last_miss_tick === yesterday;
    const next: SweepState = {
      ...keptSweep(prev),
      last_miss_tick: tick,
      measured_ms: measuredMs,
      coverage_short: missing.length,
      ...(degraded ? { degraded_at: new Date().toISOString() } : {}),
    };
    if (degraded) degradedSourceIds.push(watch.sourceId);
    queueConfigUpdate(db, updates, raw, watch.watchId, next);
  }

  for (const watch of present) {
    const raw = configs.get(watch.watchId);
    if (raw === undefined) continue;
    const prev = readSweep(raw);
    if (prev === null) continue;
    if (prev.last_miss_tick === undefined) continue;
    queueConfigUpdate(db, updates, raw, watch.watchId, coveredThisTick(prev, measuredMs));
  }

  for (const watch of invalid) {
    if (!degradedSourceIds.includes(watch.sourceId)) {
      degradedSourceIds.push(watch.sourceId);
    }
    const raw = configs.get(watch.watchId);
    if (raw === undefined) continue;
    const prev = readSweep(raw);
    if (prev === null || prev.degraded_at !== undefined) continue;
    queueConfigUpdate(db, updates, raw, watch.watchId, {
      ...prev,
      degraded_at: new Date().toISOString(),
    });
  }

  for (const chunk of chunkMessages(updates, 50)) {
    if (chunk.length > 0) await db.batch(chunk);
  }

  const queueDepth = missing.length;
  await bucket.put(
    `ads/sweeps/${tick}.json`,
    JSON.stringify({
      tick,
      measured_ms: measuredMs,
      queue_depth: queueDepth,
      selected: watches.length,
      covered: covered.size,
      retried,
      missing_watch_ids: missing.map((watch) => watch.watchId),
      degraded_source_ids: degradedSourceIds,
      priority_platforms: ["meta", "google"],
      cap: {
        page_sweep_max_concurrency: PAGE_SWEEP_MAX_CONCURRENCY,
        proposed_page_sweep_max_concurrency:
          queueDepth > 0 ? PAGE_SWEEP_MAX_CONCURRENCY + 1 : PAGE_SWEEP_MAX_CONCURRENCY,
        usd_per_additional_browser_month: USD_PER_ADDITIONAL_BROWSER_MONTH,
      },
    }),
  );

  return { degradedSourceIds, measuredMs };
}

interface WatchPullRow {
  watch_id: string;
  target_key: string;
  source_id: string;
  source_config: string;
  watch_config: string;
}

function terminal(err: unknown): boolean {
  return err instanceof AdsDescriptorError || err instanceof AdsTransportAuthError;
}

export async function consumeSweepMessage(
  db: D1Database,
  bucket: R2Bucket,
  message: SweepMessage,
  pull: SweepPull,
): Promise<SweepOutcome> {
  const row = await db
    .prepare(
      `SELECT w.id AS watch_id, w.target_key, w.config_json AS watch_config,
              s.id AS source_id, s.config_json AS source_config
       FROM watch w
       JOIN source s ON s.id = w.source_id
       JOIN entity e ON e.id = w.entity_id
       WHERE w.id = ?
         AND e.state = 'on'
         AND s.kind = 'ads'
         AND s.is_enabled = 1
         AND w.is_active = 1`,
    )
    .bind(message.watchId)
    .first<WatchPullRow>();
  if (!row) return "ack";

  let descriptor: AdsSourceDescriptor;
  try {
    descriptor = parseAdsDescriptor(row.source_config);
  } catch (err) {
    if (!terminal(err)) return "retry";
    await writePull(db, bucket, row, message, "", 0, true);
    return "ack";
  }

  let result: { payload: unknown; status: number };
  try {
    result = await pull(descriptor, row.target_key);
  } catch (err) {
    if (!terminal(err)) return "retry";
    const text = err instanceof Error ? err.message : String(err);
    await writePull(db, bucket, row, message, text, 0, true);
    return "ack";
  }

  const ok = result.status >= 200 && result.status < 300;
  const text = payloadText(result.payload);
  return writePull(db, bucket, row, message, text, result.status, !ok);
}

async function writePull(
  db: D1Database,
  bucket: R2Bucket,
  row: WatchPullRow,
  message: SweepMessage,
  text: string,
  status: number,
  blocked: boolean,
): Promise<SweepOutcome> {
  const prev = readSweep(row.watch_config);
  let configUpdate: string | null = null;
  if (blocked) {
    if (prev === null) return "retry";
    configUpdate = writeSweep(row.watch_config, {
      ...keptSweep(prev),
      blocked_status: status,
      degraded_at: new Date().toISOString(),
    });
    if (configUpdate === null) return "retry";
  } else if (prev !== null) {
    configUpdate = writeSweep(row.watch_config, recoveredPull(prev));
  }

  const key = `ads/${row.watch_id}/${message.tick}`;
  const hash = await sha256Hex(text);
  await bucket.put(key, text);
  const snapshotId = `snap-${row.watch_id}-${message.tick}`;
  const statements: D1PreparedStatement[] = [
    snapshotInsert(db, {
      id: snapshotId,
      watchId: row.watch_id,
      fetchedAt: message.tick,
      payloadR2Key: key,
      payloadHash: hash,
    }),
  ];
  if (configUpdate !== null) {
    statements.push(watchConfigUpdate(db, row.watch_id, configUpdate));
  }
  await db.batch(statements);
  return "ack";
}

export function parseSweepMessage(body: unknown): SweepMessage | null {
  const value = typeof body === "string" ? parseJson(body) : body;
  if (!isRecord(value)) return null;
  const watchId = value.watchId;
  const tick = value.tick;
  const round = value.round;
  if (typeof watchId !== "string" || watchId.length === 0) return null;
  if (typeof tick !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tick)) return null;
  if (round !== 0 && round !== 1) return null;
  return { watchId, tick, round };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}
