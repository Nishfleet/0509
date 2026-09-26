import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { pingLiveness } from "../../app/lib/liveness-ping.server";
import {
  CHUNK_SIZE,
  checkSitePage,
  planSiteSweep,
  publishSiteChange,
  uncoveredItems,
} from "../../app/lib/site/sweep.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

type PageOutcome = "failed" | "first" | "unchanged" | "changed";

export type SiteSweepOutcome = Record<PageOutcome, number> & { pages: number; rechecked: number };

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(JSON.stringify({
      event: "site.sweep_step_failed",
      step: label,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

export class SiteSweep extends WorkflowEntrypoint<Env & { SITE_SWEEP_PING_URL?: string }> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const tick = { instanceId: event.instanceId, plannedAt: event.timestamp.toISOString() };
    const targets = await step.do("plan", RETRY, () => planSiteSweep(tick.plannedAt));

    const outcomes = await targets.reduce<Promise<readonly PageOutcome[]>>(async (done, target) => {
      const previous = await done;
      const checkLabel = `check ${target.pageId}`;
      const checked = await settle(checkLabel, () =>
        step.do(checkLabel, RETRY, () => checkSitePage(target, tick)),
      );
      if (checked === null) return [...previous, "failed"];
      if (checked.outcome !== "changed") return [...previous, checked.outcome];
      const publishLabel = `publish ${target.pageId}`;
      const published = await settle(publishLabel, () =>
        step.do(publishLabel, RETRY, () => publishSiteChange(target, checked)),
      );
      return [...previous, published === null ? "failed" : "changed"];
    }, Promise.resolve([]));

    const missing = await step.do("find missing", RETRY, () =>
      uncoveredItems(targets, tick.plannedAt),
    );
    const recheckChunks = Array.from(
      { length: Math.ceil(missing.length / CHUNK_SIZE) },
      (_, index) => missing.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
    );
    const recheckOutcomes = await recheckChunks.reduce<Promise<readonly PageOutcome[]>>(
      async (done, chunk, index) => {
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
      },
      Promise.resolve([]),
    );
    const recheckByPage = new Map(
      missing.map((target, index) => [target.pageId, recheckOutcomes[index] ?? "failed"] as const),
    );
    const finalOutcomes = targets.map(
      (target, index) => recheckByPage.get(target.pageId) ?? outcomes[index] ?? "failed",
    );

    const count = (outcome: PageOutcome) => finalOutcomes.filter((o) => o === outcome).length;
    const summary: SiteSweepOutcome = {
      pages: finalOutcomes.length,
      failed: count("failed"),
      first: count("first"),
      unchanged: count("unchanged"),
      changed: count("changed"),
      rechecked: missing.length,
    };
    console.log(JSON.stringify({ event: "site.sweep", ...summary }));
    await step.do("report", RETRY, async () => {
      await pingLiveness(this.env.SITE_SWEEP_PING_URL);
      return null;
    });
    return summary;
  }
}
