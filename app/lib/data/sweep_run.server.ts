import { env } from "cloudflare:workers";
import { z } from "zod";

const INSERT_SWEEP_RUN = `INSERT INTO sweep_run
  (id, kind, planned_at, finished_at, wall_ms, pages, failed, reason)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
ON CONFLICT (id) DO UPDATE SET
  planned_at = excluded.planned_at,
  finished_at = excluded.finished_at,
  wall_ms = excluded.wall_ms,
  pages = excluded.pages,
  failed = excluded.failed,
  reason = excluded.reason`;

export interface SweepRun {
  id: string;
  kind: "site" | "mentions";
  plannedAt: string;
  finishedAt: string;
  wallMs: number;
  pages: number;
  failed: number;
  reason: string | null;
}

export async function recordSweepRun(run: SweepRun): Promise<void> {
  await env.DB.prepare(INSERT_SWEEP_RUN)
    .bind(run.id, run.kind, run.plannedAt, run.finishedAt, run.wallMs, run.pages, run.failed, run.reason)
    .run();
}

const COUNT_INCOMPLETE_MENTION_RUNS = `SELECT COUNT(*) AS n FROM sweep_run
WHERE kind = 'mentions' AND failed > 0 AND finished_at >= ?1 AND finished_at < ?2`;

const countRow = z.object({ n: z.number().int() });

export async function countIncompleteMentionRuns(
  db: D1Database,
  window: { startAt: string; endAt: string },
): Promise<number> {
  const row = await db.prepare(COUNT_INCOMPLETE_MENTION_RUNS).bind(window.startAt, window.endAt).first();
  return countRow.parse(row).n;
}
