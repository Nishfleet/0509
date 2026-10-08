import { env } from "cloudflare:workers";
import { z } from "zod";

const SELECT_VERDICT = "SELECT p FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const SELECT_CHOICE = "SELECT choice FROM jev_verdict WHERE question_id = ?1 AND input_hash = ?2";

const COUNT_VERDICTS =
  "SELECT COUNT(*) AS n FROM jev_verdict WHERE entity_id = ?1 AND decided_at >= ?2 AND question_id IN (SELECT value FROM json_each(?3))";

const COUNT_VERDICTS_ON_DAY = "SELECT COUNT(*) AS n FROM jev_verdict WHERE decided_at >= ?1 AND decided_at < ?2";

const SELECT_LAST_STILL_COMPETITOR =
  "SELECT choice, decided_at FROM jev_verdict WHERE workspace_id = ?1 AND entity_id = ?2 AND question_id = 'still_competitor_reason' AND choice IS NOT NULL ORDER BY decided_at DESC LIMIT 1";

const INSERT_VERDICT =
  "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, choice, reason, decided_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE EXISTS (SELECT 1 FROM workspace WHERE id = ?2) ON CONFLICT (question_id, input_hash) DO NOTHING";

const LINK_VERDICTS = `UPDATE jev_verdict SET signal_id = ?1
WHERE workspace_id = ?2 AND signal_id IS NULL
  AND id IN (SELECT value FROM json_each(?3))
  AND EXISTS (SELECT 1 FROM signal WHERE id = ?1)`;

const SELECT_VERDICT_IDS = `SELECT id FROM jev_verdict
WHERE workspace_id = ?1
  AND (question_id, input_hash) IN (
    SELECT json_extract(value, '$.questionId'), json_extract(value, '$.inputHash') FROM json_each(?2))`;

export interface StillCompetitorVerdict {
  choice: string;
  decidedAt: string;
}

const stillCompetitorRow = z.object({ choice: z.string(), decided_at: z.string() });

type StillCompetitorRow = z.infer<typeof stillCompetitorRow>;

export interface VerdictRow {
  workspaceId: string;
  questionId: string;
  inputHash: string;
  signalId: string | null;
  entityId: string | null;
  p: number | null;
  choice: string | null;
  reason: string | null;
  decidedAt: string;
}

const countVerdictRow = z.object({ n: z.number() });

export async function countVerdictsSince(
  entityId: string,
  sinceIso: string,
  questionIds: readonly string[],
): Promise<number> {
  const row = countVerdictRow
    .nullable()
    .parse(await env.DB.prepare(COUNT_VERDICTS).bind(entityId, sinceIso, JSON.stringify(questionIds)).first());
  return row?.n ?? 0;
}

export async function countVerdictsOnDay(db: D1Database, day: string): Promise<number> {
  const start = `${day}T00:00:00.000Z`;
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) throw new Error("countVerdictsOnDay: day is not YYYY-MM-DD");
  const end = new Date(startMs + 86_400_000).toISOString();
  const row = countVerdictRow.nullable().parse(await db.prepare(COUNT_VERDICTS_ON_DAY).bind(start, end).first());
  return row?.n ?? 0;
}

export async function insertVerdicts(rows: readonly VerdictRow[]): Promise<void> {
  if (rows.length === 0) return;
  await env.DB.batch(rows.map(insertVerdict));
}

const readCachedNoulRow = z.object({ p: z.number().nullable() });

export async function readCachedNoul(questionId: string, inputHash: string): Promise<number | null> {
  const row = readCachedNoulRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_VERDICT).bind(questionId, inputHash).first());
  return row?.p ?? null;
}

const readCachedChoiceRow = z.object({ choice: z.string().nullable() });

export async function readCachedChoice(questionId: string, inputHash: string): Promise<string | null> {
  const row = readCachedChoiceRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_CHOICE).bind(questionId, inputHash).first());
  return row?.choice ?? null;
}

export async function readLastStillCompetitor(
  workspaceId: string,
  entityId: string,
): Promise<StillCompetitorVerdict | null> {
  const row: StillCompetitorRow | null = stillCompetitorRow
    .nullable()
    .parse(await env.DB.prepare(SELECT_LAST_STILL_COMPETITOR).bind(workspaceId, entityId).first());
  if (row === null) {
    return null;
  }
  return { choice: row.choice, decidedAt: row.decided_at };
}

export function insertVerdict(row: VerdictRow): D1PreparedStatement {
  return env.DB.prepare(INSERT_VERDICT).bind(
    crypto.randomUUID(),
    row.workspaceId,
    row.questionId,
    row.inputHash,
    row.signalId,
    row.entityId,
    row.p,
    row.choice,
    row.reason,
    row.decidedAt,
  );
}

const readVerdictIdsRows = z.array(z.object({ id: z.string() }));

export async function readVerdictIds(rows: readonly VerdictRow[]): Promise<readonly string[]> {
  const [first] = rows;
  if (first === undefined) return [];
  const keys = rows.map((row) => ({ questionId: row.questionId, inputHash: row.inputHash }));
  const result = await env.DB.prepare(SELECT_VERDICT_IDS).bind(first.workspaceId, JSON.stringify(keys)).all();
  return readVerdictIdsRows.parse(result.results).map((row) => row.id);
}

export function linkVerdictsStatement(input: {
  signalId: string;
  workspaceId: string;
  verdictIds: readonly string[];
}): D1PreparedStatement {
  return env.DB.prepare(LINK_VERDICTS).bind(input.signalId, input.workspaceId, JSON.stringify(input.verdictIds));
}
