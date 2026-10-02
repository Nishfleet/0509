import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { withMonitor } from "@sentry/cloudflare";

import { readHiringTargets } from "../../app/lib/data/watch.server";
import type { BoardResult } from "../../app/lib/hiring/read-board.server";
import { readBoard } from "../../app/lib/hiring/read-board.server";
import type { FoundBoard } from "../../app/lib/hiring/sweep.server";
import { findBoard, planHiringSweep } from "../../app/lib/hiring/sweep.server";
import { isNativeSchedule } from "../workflow-crons";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const MONITOR = {
  schedule: { type: "crontab", value: "30 2 * * *" },
  checkinMargin: 60,
  timezone: "UTC",
} as const;

export interface HiringSweepOutcome {
  discovered: number;
  boards: number;
  first: number;
  unchanged: number;
  changed: number;
  newRoles: number;
  failed: number;
}

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "hiring.sweep_step_failed",
        step: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

export class HiringSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<HiringSweepOutcome | null> {
    if (isNativeSchedule(event)) return null;
    return withMonitor("hiring-sweep", () => this.runSweep(event, step), MONITOR);
  }

  private async runSweep(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<HiringSweepOutcome> {
    const tick = { instanceId: event.instanceId, plannedAt: event.timestamp.toISOString() };

    const plan = await step.do("plan", RETRY, () => planHiringSweep());

    const found = await plan.entities.reduce<Promise<readonly (FoundBoard | null)[]>>(async (done, entity) => {
      const previous = await done;
      const label = `find ${entity.id}`;
      const result = await settle(label, () => step.do(label, RETRY, () => findBoard(entity)));
      return [...previous, result];
    }, Promise.resolve([]));

    const targets = await step.do("targets", RETRY, () => readHiringTargets());

    const reads = await targets.reduce<Promise<readonly (BoardResult | null)[]>>(async (done, target) => {
      const previous = await done;
      const label = `read ${target.watchId}`;
      const result = await settle(label, () => step.do(label, RETRY, () => readBoard(target, tick)));
      return [...previous, result];
    }, Promise.resolve([]));

    const outcome = (name: BoardResult["outcome"]) => reads.filter((result) => result?.outcome === name).length;
    const summary: HiringSweepOutcome = {
      discovered: found.filter((result) => result?.watched === true).length,
      boards: targets.length,
      first: outcome("first"),
      unchanged: outcome("unchanged"),
      changed: outcome("changed"),
      newRoles: reads.reduce((total, result) => total + (result?.newRoles ?? 0), 0),
      failed: found.filter((result) => result === null).length + reads.filter((result) => result === null).length,
    };
    console.log(JSON.stringify({ event: "hiring.sweep", ...summary }));
    return summary;
  }
}
