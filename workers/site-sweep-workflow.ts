import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import type { SweepItem, SweepOutcome, SweepScope } from "../app/lib/site/sweep.server";
import { CHUNK_SIZE, countCovered, planSweep, sweepItem } from "../app/lib/site/sweep.server";

const CHECK_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "10 minutes",
};

const SCOPES: readonly SweepScope[] = ["competitors", "self"];

type SweepTally = Record<SweepOutcome, number> & { pages: number };

interface SiteSweepOutcome {
  planned: number;
  covered: number;
  short: boolean;
  tally: SweepTally;
}

function emptyTally(): SweepTally {
  return { pages: 0, failed: 0, first: 0, unchanged: 0, published: 0, quiet: 0, deferred: 0 };
}

function addOutcome(tally: SweepTally, outcome: SweepOutcome): SweepTally {
  return { ...tally, pages: tally.pages + 1, [outcome]: tally[outcome] + 1 };
}

function addTally(left: SweepTally, right: SweepTally): SweepTally {
  return {
    pages: left.pages + right.pages,
    failed: left.failed + right.failed,
    first: left.first + right.first,
    unchanged: left.unchanged + right.unchanged,
    published: left.published + right.published,
    quiet: left.quiet + right.quiet,
    deferred: left.deferred + right.deferred,
  };
}

function chunks(items: readonly SweepItem[]): SweepItem[][] {
  return Array.from(
    { length: Math.ceil(items.length / CHUNK_SIZE) },
    (_unused, index) => items.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
}

async function runChunk(
  items: readonly SweepItem[],
  instanceId: string,
  plannedAt: string,
): Promise<SweepTally> {
  const outcomes: SweepOutcome[] = [];
  for (const item of items) {
    try {
      outcomes.push(await sweepItem(item, { instanceId, plannedAt }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "site.sweep_step_failed",
        step: item.pageId,
        error: error instanceof Error ? error.message : String(error),
      }));
      outcomes.push("failed");
    }
  }
  return outcomes.reduce(addOutcome, emptyTally());
}

export class SiteSweepWorkflow extends WorkflowEntrypoint<Env & { SITE_SWEEP_PING_URL?: string }, { scope?: SweepScope }> {
  async run(event: WorkflowEvent<{ scope?: SweepScope }>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const scopes = event.payload?.scope === undefined ? SCOPES : [event.payload.scope];
    const scopeLabel = event.payload?.scope ?? "all";

    const selection = await step.do("select", async () => {
      const planned: SweepItem[] = [];
      for (const scope of scopes) planned.push(...(await planSweep(scope)));
      return { startedAt: new Date().toISOString(), items: planned };
    });
    const { startedAt, items } = selection;

    let tally: SweepTally = emptyTally();
    for (const [index, chunkItems] of chunks(items).entries()) {
      tally = addTally(
        tally,
        await step.do(`check ${String(index)}`, CHECK_STEP, () =>
          runChunk(chunkItems, event.instanceId, startedAt),
        ),
      );
    }

    const { planned, covered, short } = await step.do("assert", async () => {
      const counts: number[] = [];
      for (const scope of scopes) counts.push(await countCovered(scope, startedAt));
      const coveredCount = counts.reduce((sum, count) => sum + count, 0);
      const isShort = coveredCount < items.length;
      console.log(JSON.stringify({
        event: "site-sweep-coverage",
        scope: scopeLabel,
        planned: items.length,
        covered: coveredCount,
        short: isShort,
        tally,
      }));
      return { planned: items.length, covered: coveredCount, short: isShort };
    });

    await step.do("report", async () => {
      await pingLiveness(this.env.SITE_SWEEP_PING_URL);
      return null;
    });

    return { planned, covered, short, tally };
  }
}
