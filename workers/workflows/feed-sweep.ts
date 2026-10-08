import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { readEnabledSourceId } from "../../app/lib/data/source.server";
import { readFeedTargets } from "../../app/lib/data/watch.server";
import type { FeedResult } from "../../app/lib/feeds/read-feed.server";
import { readFeed } from "../../app/lib/feeds/read-feed.server";
import { capForNight, MAX_FEED_FINDS_PER_NIGHT, MAX_FEED_READS_PER_NIGHT } from "../../app/lib/feeds/nightly-cap";
import type { FoundFeed } from "../../app/lib/feeds/sweep.server";
import { findFeed, planFeedSweep } from "../../app/lib/feeds/sweep.server";
import { isNativeSchedule } from "../workflow-crons";
import { withStepCheckIn } from "../workflow-monitor";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const MONITOR = {
  schedule: { type: "crontab", value: "45 2 * * *" },
  checkinMargin: 60,
  maxRuntime: 90,
  timezone: "UTC",
} as const;

export interface FeedSweepOutcome {
  discovered: number;
  feeds: number;
  first: number;
  unchanged: number;
  changed: number;
  unreadable: number;
  newPosts: number;
  failed: number;
}

const IDLE: FeedSweepOutcome = {
  discovered: 0,
  feeds: 0,
  first: 0,
  unchanged: 0,
  changed: 0,
  unreadable: 0,
  newPosts: 0,
  failed: 0,
};

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "feed.sweep_step_failed",
        step: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

const NIGHTLY_CAPS = { find: MAX_FEED_FINDS_PER_NIGHT, read: MAX_FEED_READS_PER_NIGHT } as const;

function capLogged<T>(kind: keyof typeof NIGHTLY_CAPS, items: readonly T[], now: Date): readonly T[] {
  const cap = NIGHTLY_CAPS[kind];
  const { kept, dropped } = capForNight(items, cap, now);
  if (dropped > 0) {
    console.error(JSON.stringify({ event: "feed.sweep_capped", kind, cap, total: items.length, dropped }));
  }
  return kept;
}

export class FeedSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<FeedSweepOutcome | null> {
    if (isNativeSchedule(event)) return null;
    return withStepCheckIn(step, { slug: "feed-sweep", config: MONITOR }, () => this.runSweep(event, step));
  }

  private async runSweep(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<FeedSweepOutcome> {
    const tick = { instanceId: event.instanceId, plannedAt: event.timestamp.toISOString() };

    const enabled = await step.do(
      "source enabled",
      RETRY,
      async () => (await readEnabledSourceId("feed.rss")) !== null,
    );
    if (!enabled) return { ...IDLE };

    const plan = await step.do("plan", RETRY, () => planFeedSweep());
    const entities = capLogged("find", plan.entities, event.timestamp);

    const found = await entities.reduce<Promise<readonly (FoundFeed | null)[]>>(async (done, entity) => {
      const previous = await done;
      const label = `find ${entity.id}`;
      const result = await settle(label, () => step.do(label, RETRY, () => findFeed(entity)));
      return [...previous, result];
    }, Promise.resolve([]));

    const targets = capLogged("read", await step.do("targets", RETRY, () => readFeedTargets()), event.timestamp);

    const reads = await targets.reduce<Promise<readonly (FeedResult | null)[]>>(async (done, target) => {
      const previous = await done;
      const label = `read ${target.watchId}`;
      const result = await settle(label, () => step.do(label, RETRY, () => readFeed(target, tick)));
      return [...previous, result];
    }, Promise.resolve([]));

    const outcome = (name: FeedResult["outcome"]) => reads.filter((result) => result?.outcome === name).length;
    const summary: FeedSweepOutcome = {
      discovered: found.filter((result) => result?.watched === true).length,
      feeds: targets.length,
      first: outcome("first"),
      unchanged: outcome("unchanged"),
      changed: outcome("changed"),
      unreadable: outcome("unreadable"),
      newPosts: reads.reduce((total, result) => total + (result?.newPosts ?? 0), 0),
      failed: found.filter((result) => result === null).length + reads.filter((result) => result === null).length,
    };
    console.log(JSON.stringify({ event: "feed.sweep", ...summary }));
    return summary;
  }
}
