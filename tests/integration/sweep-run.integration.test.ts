import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { recordSweepRun, type SweepRun } from "../../app/lib/data/sweep_run.server";

const RUN: SweepRun = {
  id: "sweep-0509-5303",
  kind: "site",
  plannedAt: "2026-09-25T09:00:00.000Z",
  finishedAt: "2026-09-25T09:00:04.250Z",
  wallMs: 4250,
  pages: 6,
  failed: 1,
};

interface SweepRunRow {
  id: string;
  kind: string;
  planned_at: string;
  finished_at: string;
  wall_ms: number;
  pages: number;
  failed: number;
}

const readRun = async (id: string): Promise<SweepRunRow | null> =>
  env.DB.prepare(
    `SELECT id, kind, planned_at, finished_at, wall_ms, pages, failed FROM sweep_run WHERE id = ?`,
  )
    .bind(id)
    .first<SweepRunRow>();

const countRuns = async (): Promise<number> =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS total FROM sweep_run").first<{ total: number }>()
  )?.total ?? -1;

describe("sweep_run records a finished site sweep (0509#5303)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM sweep_run").run();
  });

  it("stores every measured column of one finished sweep", async () => {
    await recordSweepRun(RUN);

    expect(await readRun(RUN.id)).toEqual({
      id: "sweep-0509-5303",
      kind: "site",
      planned_at: "2026-09-25T09:00:00.000Z",
      finished_at: "2026-09-25T09:00:04.250Z",
      wall_ms: 4250,
      pages: 6,
      failed: 1,
    });
  });

  it("keeps the first row when the same sweep id is recorded twice", async () => {
    await recordSweepRun(RUN);
    await recordSweepRun({ ...RUN, finishedAt: "2026-09-25T09:05:00.000Z", wallMs: 99_999, pages: 40, failed: 40 });

    expect(await countRuns()).toBe(1);
    expect(await readRun(RUN.id)).toEqual({
      id: "sweep-0509-5303",
      kind: "site",
      planned_at: "2026-09-25T09:00:00.000Z",
      finished_at: "2026-09-25T09:00:04.250Z",
      wall_ms: 4250,
      pages: 6,
      failed: 1,
    });
  });
});
