import { createCatchUp, type RolloverBinding } from "../../app/lib/standing-schedule.server";
import {
  SIGNAL_COUNT_SQL,
  STANDING_UPSERT_SQL,
  WEIGHTS_AS_OF_SQL,
  currentWeekStart,
  freezeRanks,
  needsCatchUp,
  scoreSignals,
  weightsAsOf,
  type SignalInput,
  type WorkspaceClock,
} from "./score";

interface EntityRow {
  id: string;
}

interface WeightSql {
  key: string;
  weight: number;
  effective_from: string;
}

interface SignalSql {
  id: string;
  kind: string;
  aspect: string | null;
  published_at: string | null;
  observed_at: string;
  reliability: string;
  d3_p: number | null;
  d5_p: number | null;
  d6_p: number | null;
}

interface WorkspaceRow extends WorkspaceClock {
  standingInstanceId: string | null;
}

export interface NightlyEnv {
  DB: D1Database;
  STANDING_ROLLOVER: RolloverBinding;
}

export async function refreshWorkspace(
  db: D1Database,
  workspace: WorkspaceClock,
  now: Date,
  window?: { start: string; end: string },
): Promise<{ weekStartAt: string; scores: { entityId: string; score: number }[] }> {
  const weekStart = window?.start ?? currentWeekStart(now, workspace.timezone, workspace.briefWeekday, workspace.briefHour);
  const weekEnd = window?.end ?? now.toISOString();
  const entities = await db
    .prepare("SELECT id FROM entity WHERE workspace_id = ? AND state = 'on'")
    .bind(workspace.id)
    .all<EntityRow>();
  const ons = entities.results;
  const weightRows = await db.prepare(WEIGHTS_AS_OF_SQL).bind(weekStart, weekStart).all<WeightSql>();
  const weights = weightsAsOf(
    weightRows.results.map((row) => ({
      key: row.key,
      weight: row.weight,
      effectiveFrom: row.effective_from,
    })),
    weekStart,
  );
  const scores: { entityId: string; score: number }[] = [];
  if (ons.length > 0) {
    const readResults = await db.batch<SignalSql>(
      ons.map((entity) => db.prepare(SIGNAL_COUNT_SQL).bind(workspace.id, entity.id, weekStart, weekEnd)),
    );
    for (let index = 0; index < ons.length; index += 1) {
      const entity = ons[index];
      const result = readResults[index];
      if (!entity || !result) continue;
      scores.push({
        entityId: entity.id,
        score: scoreSignals(result.results.map(toSignal), weights, weekStart, weekEnd),
      });
    }
  }
  if (scores.length > 0) {
    const computedAt = now.toISOString();
    await db.batch(
      scores.map((row) =>
        db.prepare(STANDING_UPSERT_SQL).bind(
          crypto.randomUUID(),
          workspace.id,
          row.entityId,
          weekStart,
          row.score,
          computedAt,
        ),
      ),
    );
  }
  return { weekStartAt: weekStart, scores };
}

export async function freezeWeek(
  db: D1Database,
  workspaceId: string,
  weekStart: string,
  previousWeekStart: string,
): Promise<{ entityId: string; rank: number; movement: number | null }[]> {
  const current = await db
    .prepare("SELECT entity_id, score FROM standing WHERE workspace_id = ? AND week_start_at = ?")
    .bind(workspaceId, weekStart)
    .all<{ entity_id: string; score: number }>();
  const previous = await db
    .prepare(
      "SELECT entity_id, rank FROM standing WHERE workspace_id = ? AND week_start_at = ? AND rank IS NOT NULL",
    )
    .bind(workspaceId, previousWeekStart)
    .all<{ entity_id: string; rank: number }>();
  const previousRank = new Map(previous.results.map((row) => [row.entity_id, row.rank]));
  const frozen = freezeRanks(
    current.results.map((row) => ({
      entityId: row.entity_id,
      score: row.score,
      previousRank: previousRank.get(row.entity_id) ?? null,
    })),
  );
  if (frozen.length === 0) return frozen;
  await db.batch(
    frozen.map((row) =>
      db
        .prepare(
          "UPDATE standing SET rank = ?, movement = ? WHERE workspace_id = ? AND entity_id = ? AND week_start_at = ?",
        )
        .bind(row.rank, row.movement, workspaceId, row.entityId, weekStart),
    ),
  );
  return frozen;
}

export async function runNightly(env: NightlyEnv, now = new Date()): Promise<string[]> {
  const listed = await env.DB.prepare(
    `SELECT id, timezone, brief_weekday AS briefWeekday, brief_hour AS briefHour,
            standing_instance_id AS standingInstanceId
     FROM workspace`,
  ).all<WorkspaceRow>();
  const catchUps: string[] = [];
  for (const workspace of listed.results) {
    const week = currentWeekStart(now, workspace.timezone, workspace.briefWeekday, workspace.briefHour);
    const latest = await env.DB.prepare(
      "SELECT MAX(week_start_at) AS latest FROM standing WHERE workspace_id = ?",
    )
      .bind(workspace.id)
      .first<{ latest: string | null }>();
    const stale = needsCatchUp(latest?.latest ?? null, week);
    await refreshWorkspace(env.DB, workspace, now);
    if (!stale) continue;
    const id = await createCatchUp(
      env.STANDING_ROLLOVER,
      env.DB,
      workspace,
      workspace.standingInstanceId,
      now,
    );
    if (id) catchUps.push(id);
  }
  return catchUps;
}

function toSignal(row: SignalSql): SignalInput {
  return {
    id: row.id,
    kind: row.kind,
    aspect: row.aspect,
    publishedAt: row.published_at,
    observedAt: row.observed_at,
    reliability: row.reliability,
    d3p: row.d3_p,
    d5p: row.d5_p,
    d6p: row.d6_p,
  };
}
