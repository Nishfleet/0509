import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { withMonitor } from "@sentry/cloudflare";

import { recordSweepRun } from "../../app/lib/data/sweep_run.server";
import { pingLiveness } from "../../app/lib/liveness-ping.server";
import {
  CHUNK_SIZE,
  checkSitePage,
  classifyCompetitorSites,
  planSiteSweep,
  publishSiteChange,
  uncoveredItems,
} from "../../app/lib/site/sweep.server";
import { plannedAt } from "../../app/lib/workflow-time";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const MONITOR = {
  schedule: { type: "crontab", value: "0 2 * * *" },
  checkinMargin: 60,
  timezone: "UTC",
} as const;

type PageOutcome = "failed" | "gone" | "first" | "unchanged" | "changed";

export type SiteSweepOutcome = Record<PageOutcome, number> & {
  pages: number;
  rechecked: number;
  recorded: boolean;
};

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "site.sweep_step_failed",
        step: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

type SweepTargets = Awaited<ReturnType<typeof planSiteSweep>>;

interface SweepTick {
  instanceId: string;
  plannedAt: string;
}

function checkTargets(step: WorkflowStep, targets: SweepTargets, tick: SweepTick): Promise<readonly PageOutcome[]> {
  return targets.reduce<Promise<readonly PageOutcome[]>>(async (done, target) => {
    const previous = await done;
    const checkLabel = `check ${target.pageId}`;
    const checked = await settle(checkLabel, () => step.do(checkLabel, RETRY, () => checkSitePage(target, tick)));
    if (checked === null) return [...previous, "failed"];
    if (checked.outcome !== "changed") return [...previous, checked.outcome];
    const publishLabel = `publish ${target.pageId}`;
    const published = await settle(publishLabel, () =>
      step.do(publishLabel, RETRY, () => publishSiteChange(target, checked)),
    );
    return [...previous, published === null ? "failed" : "changed"];
  }, Promise.resolve([]));
}

function recheckMissing(step: WorkflowStep, missing: SweepTargets, tick: SweepTick): Promise<readonly PageOutcome[]> {
  const recheckChunks = Array.from({ length: Math.ceil(missing.length / CHUNK_SIZE) }, (_, index) =>
    missing.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
  return recheckChunks.reduce<Promise<readonly PageOutcome[]>>(async (done, chunk, index) => {
    const previous = await done;
    const recheckLabel = `recheck ${String(index)}`;
    const settled = await settle(recheckLabel, () =>
      step.do(recheckLabel, RETRY, () =>
        chunk.reduce<Promise<readonly PageOutcome[]>>(async (pending, target) => {
          const earlier = await pending;
          const checked = await checkSitePage(target, tick);
          if (checked.outcome === "changed") await publishSiteChange(target, checked);
          return [...earlier, checked.outcome];
        }, Promise.resolve([])),
      ),
    );
    return [...previous, ...(settled ?? chunk.map(() => "failed" as const))];
  }, Promise.resolve([]));
}

async function recordRun(
  step: WorkflowStep,
  tick: SweepTick,
  totals: { pages: number; failed: number },
): Promise<boolean> {
  const recorded = await settle("record", () =>
    step.do("record", RETRY, async () => {
      const finishedAt = new Date();
      await recordSweepRun({
        id: tick.instanceId,
        kind: "site",
        plannedAt: tick.plannedAt,
        finishedAt: finishedAt.toISOString(),
        wallMs: finishedAt.getTime() - Date.parse(tick.plannedAt),
        pages: totals.pages,
        failed: totals.failed,
      });
      return true;
    }),
  );
  return recorded === true;
}

export class SiteSweep extends WorkflowEntrypoint<Env & { SITE_SWEEP_PING_URL?: string }> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    return withMonitor("site-sweep", () => this.runSweep(event, step), MONITOR);
  }

  private async runSweep(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const tick = {
      instanceId: event.instanceId,
      plannedAt: plannedAt(event.timestamp, event.schedule?.scheduledTime),
    };
    await settle("classify", () => step.do("classify", RETRY, () => classifyCompetitorSites(tick.plannedAt)));
    const targets = await step.do("plan", RETRY, () => planSiteSweep(tick.plannedAt));

    const outcomes = await checkTargets(step, targets, tick);

    const missing = await step.do("find missing", RETRY, () => uncoveredItems(targets, tick.plannedAt));
    const recheckOutcomes = await recheckMissing(step, missing, tick);
    const recheckByPage = new Map(missing.map((target, index) => [target.pageId, recheckOutcomes[index]] as const));
    const finalOutcomes = targets.map((target, index) => recheckByPage.get(target.pageId) ?? outcomes[index]);

    const count = (outcome: PageOutcome) => finalOutcomes.filter((o) => o === outcome).length;
    const pages = finalOutcomes.length;
    const failed = count("failed");
    const recorded = await recordRun(step, tick, { pages, failed });
    const summary: SiteSweepOutcome = {
      pages,
      failed,
      gone: count("gone"),
      first: count("first"),
      unchanged: count("unchanged"),
      changed: count("changed"),
      rechecked: missing.length,
      recorded,
    };
    console.log(JSON.stringify({ event: "site.sweep", ...summary }));
    await step.do("report", RETRY, async () => {
      await pingLiveness(this.env.SITE_SWEEP_PING_URL);
      return null;
    });
    return summary;
  }
}
