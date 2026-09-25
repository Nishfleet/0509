import { env } from "cloudflare:workers";

const INSERT_SWEEP_RUN = `INSERT INTO sweep_run
  (id, kind, planned_at, finished_at, wall_ms, pages, failed)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT (id) DO NOTHING`;

export interface SweepRun {
  id: string;
  kind: "site";
  plannedAt: string;
  finishedAt: string;
  wallMs: number;
  pages: number;
  failed: number;
}

export async function recordSweepRun(run: SweepRun): Promise<void> {
  await env.DB.prepare(INSERT_SWEEP_RUN)
    .bind(run.id, run.kind, run.plannedAt, run.finishedAt, run.wallMs, run.pages, run.failed)
    .run();
}
