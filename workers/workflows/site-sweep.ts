import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { SITE_SWEEP_CRON, sweepMonitor } from "../../app/lib/cadence";
import { recordSweepRun } from "../../app/lib/data/sweep_run.server";
import { pingLiveness } from "../../app/lib/liveness-ping.server";
import { classifyCompetitorSites } from "../../app/lib/site/classify-competitors.server";
import { sweepRunReason, type SweepStepFailure } from "../../app/lib/site/sweep-run-reason";
import {
  CHUNK_SIZE,
  checkSitePage,
  planSiteSweep,
  publishSiteChange,
  uncoveredItems,
} from "../../app/lib/site/sweep.server";
import { plannedAt } from "../../app/lib/workflow-time";
import { isNativeSchedule } from "../workflow-crons";
import { withStepCheckIn } from "../workflow-monitor";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const MONITOR = { ...sweepMonitor(SITE_SWEEP_CRON), timezone: "UTC" } as const;

type PageOutcome = "failed" | "gone" | "first" | "unchanged" | "changed";

export type SiteSweepOutcome = Record<PageOutcome, number> & {
  pages: number;
  rechecked: number;
  recorded: boolean;
};

type FailureSink = (failure: SweepStepFailure) => void;

async function settle<T>(label: string, run: () => Promise<T>, onFailure?: FailureSink): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onFailure?.({ step: label, error: message });
    console.error(
      JSON.stringify({
        event: "site.sweep_step_failed",
        step: label,
        error: message,
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

interface SweepExecution {
  tick: SweepTick;
  pageFailures: Map<string, SweepStepFailure>;
}

interface RecheckResult {
  outcome: PageOutcome;
  error: string | null;
}

function failPage(run: SweepExecution, pageId: string): FailureSink {
  return (failure) => run.pageFailures.set(pageId, failure);
}

function checkTargets(step: WorkflowStep, targets: SweepTargets, run: SweepExecution): Promise<readonly PageOutcome[]> {
  return targets.reduce<Promise<readonly PageOutcome[]>>(async (done, target) => {
    const previous = await done;
    const checkLabel = `check ${target.pageId}`;
    const checked = await settle(
      checkLabel,
      () => step.do(checkLabel, RETRY, () => checkSitePage(target, run.tick)),
      failPage(run, target.pageId),
    );
    if (checked === null) return [...previous, "failed"];
    if (checked.outcome === "failed") {
      run.pageFailures.set(target.pageId, { step: checkLabel, error: `${checked.reason}: ${checked.detail}` });
      return [...previous, "failed"];
    }
    if (checked.outcome !== "changed") return [...previous, checked.outcome];
    const publishLabel = `publish ${target.pageId}`;
    const published = await settle(
      publishLabel,
      () => step.do(publishLabel, RETRY, () => publishSiteChange(target, checked)),
      failPage(run, target.pageId),
    );
    return [...previous, published === null ? "failed" : "changed"];
  }, Promise.resolve([]));
}

function recheckChunk(chunk: SweepTargets, tick: SweepTick): Promise<RecheckResult[]> {
  return chunk.reduce<Promise<RecheckResult[]>>(async (pending, target) => {
    const earlier = await pending;
    const checked = await checkSitePage(target, tick);
    if (checked.outcome === "changed") await publishSiteChange(target, checked);
    const error = checked.outcome === "failed" ? `${checked.reason}: ${checked.detail}` : null;
    return [...earlier, { outcome: checked.outcome, error }];
  }, Promise.resolve([]));
}

function settleRechecks(
  run: SweepExecution,
  recheck: { chunk: SweepTargets; label: string },
  results: RecheckResult[] | null,
): PageOutcome[] {
  return recheck.chunk.map((target, index): PageOutcome => {
    const result = results?.[index];
    if (result === undefined) return "failed";
    if (result.error === null) run.pageFailures.delete(target.pageId);
    else run.pageFailures.set(target.pageId, { step: `${recheck.label} ${target.pageId}`, error: result.error });
    return result.outcome;
  });
}

function recheckMissing(
  step: WorkflowStep,
  missing: SweepTargets,
  run: SweepExecution,
): Promise<readonly PageOutcome[]> {
  const recheckChunks = Array.from({ length: Math.ceil(missing.length / CHUNK_SIZE) }, (_, index) =>
    missing.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
  return recheckChunks.reduce<Promise<readonly PageOutcome[]>>(async (done, chunk, index) => {
    const previous = await done;
    const recheckLabel = `recheck ${String(index)}`;
    const settled = await settle(
      recheckLabel,
      () => step.do(recheckLabel, RETRY, () => recheckChunk(chunk, run.tick)),
      (failure) => {
        for (const target of chunk) run.pageFailures.set(target.pageId, failure);
      },
    );
    return [...previous, ...settleRechecks(run, { chunk, label: recheckLabel }, settled)];
  }, Promise.resolve([]));
}

function finalFailures(run: SweepExecution, targets: SweepTargets, outcomes: readonly (PageOutcome | undefined)[]) {
  return targets.flatMap((target, index) => {
    if (outcomes[index] !== "failed") return [];
    return [run.pageFailures.get(target.pageId) ?? { step: `check ${target.pageId}`, error: "failed" }];
  });
}

async function recordRun(
  step: WorkflowStep,
  run: SweepExecution,
  totals: { pages: number; failed: number; reason: string | null },
): Promise<boolean> {
  const tick = run.tick;
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
        reason: totals.reason,
      });
      return true;
    }),
  );
  return recorded === true;
}

export class SiteSweep extends WorkflowEntrypoint<Env & { SITE_SWEEP_PING_URL?: string }> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome | null> {
    if (isNativeSchedule(event)) return null;
    return withStepCheckIn(step, { slug: "site-sweep", config: MONITOR }, () => this.runSweep(event, step));
  }

  private async runSweep(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const tick = {
      instanceId: event.instanceId,
      plannedAt: plannedAt(event.timestamp, event.schedule?.scheduledTime),
    };
    const run: SweepExecution = { tick, pageFailures: new Map() };
    await settle("classify", () => step.do("classify", RETRY, () => classifyCompetitorSites(tick.plannedAt)));
    const targets = await step.do("plan", RETRY, () => planSiteSweep(tick.plannedAt));

    const outcomes = await checkTargets(step, targets, run);

    const missing = await step.do("find missing", RETRY, () => uncoveredItems(targets, tick.plannedAt));
    const recheckOutcomes = await recheckMissing(step, missing, run);
    const recheckByPage = new Map(missing.map((target, index) => [target.pageId, recheckOutcomes[index]] as const));
    const finalOutcomes = targets.map((target, index) => recheckByPage.get(target.pageId) ?? outcomes[index]);

    const count = (outcome: PageOutcome) => finalOutcomes.filter((o) => o === outcome).length;
    const pages = finalOutcomes.length;
    const failed = count("failed");
    const reason = sweepRunReason(finalFailures(run, targets, finalOutcomes), failed, pages);
    const recorded = await recordRun(step, run, { pages, failed, reason });
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
