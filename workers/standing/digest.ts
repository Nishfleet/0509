import { d4PackSchema, hashPack, type D4Pack } from "../jev/context-pack";
import { suppressQuietWeek, type SourceHealth } from "./present";
import { postReadThisFirst, selectReadThisFirst, whyLineFor, type D4Candidate } from "./read-this-first";

interface ItemRow {
  id: string;
  entity_id: string;
  kind: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  evidence_url: string | null;
  observed_at: string;
  source_key: string;
}

interface BrandRow {
  id: string;
  role: string;
  name: string | null;
  domain: string;
  state: string;
  identity_json: string;
}

interface HistoryRow {
  entity_id: string;
  kind: string;
  title: string | null;
  observed_at: string;
}

interface MemoryRow {
  entity_id: string | null;
  verdict: string;
  note: string | null;
  decided_at: string;
}

interface CountRow {
  kind: string;
  published_at: string | null;
}

export interface DigestWrite {
  id: string;
  pending: boolean;
}

const ELIGIBLE_SQL = `
SELECT s.id, s.entity_id, s.kind, s.title, s.summary, s.url, s.evidence_url, s.observed_at,
       src.key AS source_key
FROM signal AS s
JOIN source AS src ON src.id = s.source_id
JOIN jev_verdict AS v ON v.signal_id = s.id
WHERE s.workspace_id = ?
  AND s.entity_id = ?
  AND s.observed_at >= ?
  AND s.observed_at < ?
  AND s.is_tombstoned = 0
  AND (
    (v.question_id = 'noteworthy_change' AND v.p >= 0.9)
    OR (v.question_id = 'mention_matters' AND v.p >= 0.9)
  )
`;

export async function writeDigest(
  db: D1Database,
  workspaceId: string,
  windowStart: string,
  windowEnd: string,
  pending: boolean,
): Promise<DigestWrite> {
  const id = crypto.randomUUID();
  const payload = await composePayload(db, workspaceId, windowStart, windowEnd, pending);
  await db.prepare(
    `INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json)
     VALUES (?, ?, 'weekly', ?, ?, 'pending', ?)`,
  ).bind(id, workspaceId, windowStart, windowEnd, JSON.stringify(payload)).run();
  return { id, pending: payload.d4_pending };
}

export async function ensureVerdicts(
  db: D1Database,
  workspaceId: string,
  windowStart: string,
  windowEnd: string,
  jev: { url: string; token: string } | null,
): Promise<boolean> {
  const brands = await loadBrands(db, workspaceId);
  const self = brands.find((brand) => brand.role === "self");
  const entities = await db.prepare(
    "SELECT id FROM entity WHERE workspace_id = ? AND state = 'on'",
  ).bind(workspaceId).all<{ id: string }>();
  const ons = entities.results;
  if (!self || ons.length === 0) return jev === null;
  const reads = await db.batch<ItemRow>(ons.map((entity) => db.prepare(ELIGIBLE_SQL).bind(
    workspaceId,
    entity.id,
    windowStart,
    windowEnd,
  )));
  const items = dedupe(reads.flatMap((result) => result.results));
  const historySince = new Date(Date.parse(windowEnd) - 30 * 24 * 60 * 60 * 1000).toISOString();
  const history = await db.prepare(
    `SELECT s.entity_id, s.kind, s.title, s.observed_at
     FROM signal AS s
     JOIN jev_verdict AS v ON v.signal_id = s.id
     WHERE s.workspace_id = ? AND s.observed_at >= ? AND s.observed_at < ? AND s.is_tombstoned = 0
       AND v.p >= 0.9 AND v.question_id IN ('noteworthy_change', 'mention_matters')`,
  ).bind(workspaceId, historySince, windowEnd).all<HistoryRow>();
  const memory = await db.prepare(
    "SELECT entity_id, verdict, note, decided_at FROM user_decision WHERE workspace_id = ?",
  ).bind(workspaceId).all<MemoryRow>();
  let pending = jev === null;
  for (let index = 0; index < items.length; index += 10) {
    const chunk = items.slice(index, index + 10);
    const outcomes = await Promise.all(chunk.map((item) => judgeItem(
      db,
      workspaceId,
      item,
      self,
      brands,
      history.results,
      memory.results,
      jev,
    )));
    if (outcomes.some((outcome) => outcome === "pending")) pending = true;
  }
  return pending;
}

async function judgeItem(
  db: D1Database,
  workspaceId: string,
  item: ItemRow,
  self: BrandRow,
  brands: BrandRow[],
  history: HistoryRow[],
  memory: MemoryRow[],
  jev: { url: string; token: string } | null,
): Promise<"cached" | "called" | "pending"> {
  const subject = brands.find((brand) => brand.id === item.entity_id);
  if (!subject) return "pending";
  const pack = d4PackSchema.parse({
    self: brandCard(self),
    subject: brandCard(subject),
    competitor_set: brands
      .filter((brand) => brand.id !== subject.id && brand.role === "competitor")
      .map((brand) => ({ name: brand.name, domain: brand.domain })),
    item: {
      signal_id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      url: item.url,
      evidence_url: item.evidence_url,
      observed_at: item.observed_at,
      source_key: item.source_key,
    },
    history_30d: history
      .filter((row) => row.entity_id === subject.id)
      .map((row) => ({ kind: row.kind, title: row.title, observed_at: row.observed_at })),
    user_memory: memory
      .filter((row) => row.entity_id === subject.id)
      .map((row) => ({ verdict: row.verdict, note: row.note, decided_at: row.decided_at })),
  });
  const inputHash = await hashPack(pack);
  const cached = await db.prepare(
    "SELECT p, score, reason FROM jev_verdict WHERE question_id = 'read_this_first' AND input_hash = ?",
  ).bind(inputHash).first<{ p: number | null; score: number | null; reason: string | null }>();
  if (cached) return "cached";
  if (!jev) return "pending";
  const verdict = await postReadThisFirst(jev.url, jev.token, pack);
  if (!verdict) return "pending";
  const decidedAt = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO jev_verdict
        (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, score, reason, decided_at)
       VALUES (?, ?, 'read_this_first', ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), workspaceId, inputHash, item.id, item.entity_id, verdict.p, verdict.reason, decidedAt),
    db.prepare(
      `INSERT OR IGNORE INTO jev_verdict
        (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, score, reason, decided_at)
       VALUES (?, ?, 'read_this_first_importance', ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      workspaceId,
      inputHash,
      item.id,
      item.entity_id,
      verdict.importance,
      verdict.reason,
      decidedAt,
    ),
  ]);
  return "called";
}

async function composePayload(
  db: D1Database,
  workspaceId: string,
  windowStart: string,
  windowEnd: string,
  pending: boolean,
) {
  const sources = await loadSourceHealth(db, workspaceId);
  const ranks = await db.prepare(
    `SELECT s.entity_id, s.rank, s.score, s.movement, e.name
     FROM standing AS s JOIN entity AS e ON e.id = s.entity_id
     WHERE s.workspace_id = ? AND s.week_start_at = ? AND s.rank IS NOT NULL
     ORDER BY s.rank`,
  ).bind(workspaceId, windowStart).all<{
    entity_id: string;
    rank: number;
    score: number;
    movement: number | null;
    name: string | null;
  }>();
  const verdicts = await db.prepare(
    `SELECT v.signal_id, v.question_id, v.p, v.score, v.reason, s.title, s.evidence_url
     FROM jev_verdict AS v JOIN signal AS s ON s.id = v.signal_id
     WHERE v.workspace_id = ? AND s.observed_at >= ? AND s.observed_at < ?
       AND v.question_id IN ('read_this_first', 'read_this_first_importance')`,
  ).bind(workspaceId, windowStart, windowEnd).all<{
    signal_id: string;
    question_id: string;
    p: number | null;
    score: number | null;
    reason: string | null;
    title: string | null;
    evidence_url: string | null;
  }>();
  const bySignal = new Map<string, D4Candidate>();
  for (const row of verdicts.results) {
    const current = bySignal.get(row.signal_id) ?? {
      signalId: row.signal_id,
      p: 0,
      importance: 0,
      reason: row.reason,
      title: row.title,
      evidenceUrl: row.evidence_url,
    };
    if (row.question_id === "read_this_first" && row.p !== null) current.p = row.p;
    if (row.question_id === "read_this_first_importance" && row.score !== null) current.importance = row.score;
    if (row.reason) current.reason = row.reason;
    bySignal.set(row.signal_id, current);
  }
  const chosen = selectReadThisFirst([...bySignal.values()]);
  const counts = await countWindow(db, workspaceId, windowStart, windowEnd);
  const degraded = suppressQuietWeek(sources);
  const why = whyLineFor(chosen, counts, degraded, pending);
  const paused = await db.prepare(
    `SELECT name, state_reason FROM entity
     WHERE workspace_id = ? AND state = 'off' AND state_changed_at >= ? AND state_changed_at < ?`,
  ).bind(workspaceId, windowStart, windowEnd).all<{ name: string | null; state_reason: string | null }>();
  return {
    week_start_at: windowStart,
    period_end: windowEnd,
    ranks: ranks.results.map((row) => ({
      entity_id: row.entity_id,
      rank: row.rank,
      score: row.score,
      movement: row.movement,
      name: row.name,
    })),
    why_line: why.line,
    why_source: why.source,
    read_this_first: chosen.map((item) => ({
      signal_id: item.signalId,
      title: item.title,
      evidence_url: item.evidenceUrl,
      reason: item.reason,
      importance: item.importance,
      p: item.p,
    })),
    counts: { mentions: counts.mentions, site_changes: counts.siteChanges, new_ads: counts.newAds },
    paused: paused.results,
    quiet_week: why.source === "counts",
    d4_pending: pending && chosen.length === 0,
  };
}

async function countWindow(db: D1Database, workspaceId: string, windowStart: string, windowEnd: string) {
  const rows = await db.prepare(
    `SELECT kind, published_at FROM signal
     WHERE workspace_id = ? AND observed_at >= ? AND observed_at < ? AND is_tombstoned = 0`,
  ).bind(workspaceId, windowStart, windowEnd).all<CountRow>();
  let mentions = 0;
  let siteChanges = 0;
  let newAds = 0;
  for (const row of rows.results) {
    if (row.kind === "mention") mentions += 1;
    if (row.kind === "change") siteChanges += 1;
    if (row.kind === "ad" && row.published_at && row.published_at >= windowStart && row.published_at < windowEnd) {
      newAds += 1;
    }
  }
  return { mentions, siteChanges, newAds };
}

async function loadBrands(db: D1Database, workspaceId: string): Promise<BrandRow[]> {
  const rows = await db.prepare(
    "SELECT id, role, name, domain, state, identity_json FROM entity WHERE workspace_id = ?",
  ).bind(workspaceId).all<BrandRow>();
  return rows.results;
}

function brandCard(brand: BrandRow): D4Pack["self"] {
  return {
    name: brand.name,
    domain: brand.domain,
    state: brand.state,
    identity: readIdentity(brand.identity_json),
  };
}

function readIdentity(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const identity: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) identity[key] = value;
    return identity;
  } catch {
    return {};
  }
}

async function loadSourceHealth(db: D1Database, workspaceId: string): Promise<SourceHealth[]> {
  const rows = await db.prepare(
    `SELECT src.platform AS name, json_extract(src.config_json, '$.canary') AS canary,
            MAX(sn.fetched_at) AS last_fetched_at
     FROM source AS src
     LEFT JOIN watch AS w ON w.source_id = src.id
     LEFT JOIN entity AS e ON e.id = w.entity_id AND e.workspace_id = ?
     LEFT JOIN snapshot AS sn ON sn.watch_id = w.id
     WHERE src.is_enabled = 1
     GROUP BY src.id`,
  ).bind(workspaceId).all<{ name: string; canary: number | null; last_fetched_at: string | null }>();
  return rows.results.map((row) => ({
    name: row.name,
    canary: typeof row.canary === "number" ? row.canary : null,
    lastFetchedAt: row.last_fetched_at,
  }));
}

function dedupe(items: ItemRow[]): ItemRow[] {
  const seen = new Set<string>();
  const unique: ItemRow[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}
