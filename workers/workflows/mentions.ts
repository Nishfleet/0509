import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { captureException } from "@sentry/cloudflare";

import { MENTIONS_SWEEP_CRON, sweepMonitor } from "../../app/lib/cadence";
import { markSourceDegraded, readCanarySources } from "../../app/lib/data/source.server";
import { recordSweepRun } from "../../app/lib/data/sweep_run.server";
import { NOT_READ_REASON } from "../../app/lib/source-status-words";
import { bySourceRoundRobin, FAILED_TARGET_MS, SweepBudget, timed } from "../mentions/budget";
import { runCanary } from "../mentions/canary";
import { lostSources, mentionsHealth, skippedTargets } from "../mentions/health";
import type { Streaks } from "../mentions/retry";
import { deferred, retrySkipped, sustainedSkips, track, tripped } from "../mentions/retry";
import type { MentionTarget, TargetOutcome } from "../mentions/sweep";
import { planTargets, sweepTarget } from "../mentions/sweep";
import { isNativeSchedule } from "../workflow-crons";
import { withStepCheckIn } from "../workflow-monitor";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
};

const MONITOR = { ...sweepMonitor(MENTIONS_SWEEP_CRON), timezone: "UTC" } as const;

export interface MentionsOutcome {
  targets: number;
  swept: number;
  failed: number;
  missed: string[];
  skippedTargets: number;
  stored: number;
  unjudged: number;
  skipped: number;
}

export class MentionsSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<MentionsOutcome | null> {
    if (isNativeSchedule(event)) return null;
    return withStepCheckIn(
      step,
      {
        slug: "mentions-sweep",
        config: MONITOR,
        health: mentionsHealth,
      },
      () => this.runMentions(event, step),
    );
  }

  private async runMentions(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<MentionsOutcome> {
    const now = event.timestamp.toISOString();
    const planned = await step.do("plan", RETRY, () => planTargets());
    const targets = bySourceRoundRobin(planned);
    const counts = await this.canaries(step, now);
    const run = (target: MentionTarget) => timed(() => sweepTarget(target, now, counts.get(target.sourceId) ?? null));
    const budget = new SweepBudget();
    const outcomes = await this.firstPass(step, targets, { run, budget });
    const settled = await retrySkipped(step, { targets, outcomes, run, budget });
    for (const entry of budget.deferred()) {
      console.warn(JSON.stringify({ event: "mentions.targets_skipped", ...entry }));
    }
    await this.markCut(step, targets, budget);
    for (const entry of sustainedSkips({ targets, outcomes: settled, run, budget })) {
      const message = JSON.stringify({ event: "mentions.sustained_skips", ...entry });
      console.error(message);
      captureException(new Error(message), { tags: { lane: "mentions", source: entry.pluginKey } });
    }
    const done = settled.filter((outcome): outcome is TargetOutcome => outcome !== null);
    const result = {
      targets: targets.length,
      swept: done.length,
      failed: settled.length - done.length,
      missed: lostSources(targets, settled),
      skippedTargets: skippedTargets(settled),
      stored: done.reduce((sum, outcome) => sum + outcome.stored, 0),
      unjudged: done.reduce((sum, outcome) => sum + outcome.unjudged, 0),
      skipped: done.reduce((sum, outcome) => sum + outcome.skipped, 0),
    };
    const deferredTargets = budget.deferred().reduce((sum, entry) => sum + entry.targets, 0);
    console.warn(JSON.stringify({ event: "mentions.sweep", ...result, deferred: deferredTargets }));
    await this.record(step, event, result);
    return result;
  }

  private async markCut(step: WorkflowStep, targets: readonly MentionTarget[], budget: SweepBudget): Promise<void> {
    const cut = budget.deferred();
    if (cut.length === 0) return;
    const sourceOf = new Map(targets.map((target) => [target.pluginKey, target.sourceId]));
    try {
      await step.do("mark the sources the run did not finish", RETRY, async () => {
        for (const entry of cut) {
          const sourceId = sourceOf.get(entry.source);
          if (sourceId !== undefined) await markSourceDegraded(sourceId, NOT_READ_REASON);
        }
        return cut.length;
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "mentions.mark_cut_failed", message: String(error) }));
    }
  }

  private async record(step: WorkflowStep, event: WorkflowEvent<unknown>, result: MentionsOutcome): Promise<void> {
    await step.do("record", RETRY, async () => {
      const finishedAt = new Date();
      await recordSweepRun({
        id: event.instanceId,
        kind: "mentions",
        plannedAt: event.timestamp.toISOString(),
        finishedAt: finishedAt.toISOString(),
        wallMs: finishedAt.getTime() - event.timestamp.getTime(),
        pages: result.targets,
        failed: result.failed + result.skippedTargets,
        reason: result.missed.length === 0 ? null : result.missed.join(", "),
      });
    });
  }

  private async canaries(step: WorkflowStep, now: string): Promise<Map<string, number>> {
    const canarySources = await step.do("canary plan", RETRY, () => readCanarySources());
    const counts = new Map<string, number>();
    for (const source of canarySources) {
      const count = await step.do(`canary ${source.pluginKey}`, RETRY, () => runCanary(source, now));
      if (count !== null) counts.set(source.id, count);
      if (source.minIntervalSeconds > 0) {
        await step.sleep(`pace canary ${source.pluginKey}`, source.minIntervalSeconds * 1000);
      }
    }
    return counts;
  }

  private async firstPass(
    step: WorkflowStep,
    targets: MentionTarget[],
    sweep: { run: (target: MentionTarget) => Promise<TargetOutcome>; budget: SweepBudget },
  ): Promise<(TargetOutcome | null)[]> {
    const { run, budget } = sweep;
    const outcomes: (TargetOutcome | null)[] = [];
    const streaks: Streaks = new Map();
    for (const [index, target] of targets.entries()) {
      const spent = budget.spent();
      if (spent) budget.defer(target.pluginKey);
      if (spent || tripped(streaks, target)) {
        outcomes.push(deferred(target));
        continue;
      }
      try {
        const outcome = await step.do(`sweep ${target.pluginKey} ${target.query}`, RETRY, () => run(target));
        budget.spend(outcome.ms ?? 0);
        track(streaks, target, outcome);
        outcomes.push(outcome);
      } catch (error) {
        budget.spend(FAILED_TARGET_MS);
        console.error(
          JSON.stringify({ event: "mentions.target_failed", source: target.pluginKey, message: String(error) }),
        );
        outcomes.push(null);
      }
      if (target.minIntervalSeconds > 0 && index < targets.length - 1) {
        await step.sleep(`pace ${String(index)}`, target.minIntervalSeconds * 1000);
        budget.spend(target.minIntervalSeconds * 1000);
      }
    }
    return outcomes;
  }
}
