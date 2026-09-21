/**
 * The daily site sweep as a Cloudflare Workflow — the durable shape the stack
 * doc names for "cron fires, then a Workflow" (docs/REBUILD-STACK.md §4.1).
 * step.do carries retries so a transient Browser Run or Jev failure re-runs
 * that watch instead of killing the sweep; a watch that exhausts its retries
 * is recorded and the sweep continues.
 *
 * SWEEP_CONCURRENCY is the browser cap from docs/REBUILD-COST.md as a config
 * value: at most 10 watches in flight, so at most 10 simultaneous browsers —
 * the included allotment. Raising it is a $2.00/browser-month decision that
 * belongs to Nish.
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  recordWatchFailure,
  sweepWatch,
  type PageResult,
  type SweepEnv,
} from "../app/lib/site/sweep.server";
import { listDueSiteWatches } from "../app/lib/data/watch.server";

const SWEEP_CONCURRENCY = 10;

interface SweepParams {
  watchIds?: string[];
}

interface WatchOutcome {
  watch_id: string;
  ok: boolean;
  pages?: PageResult[];
  error?: string;
}

export class SiteSweepWorkflow extends WorkflowEntrypoint<Env, SweepParams> {
  async run(event: WorkflowEvent<SweepParams>, step: WorkflowStep) {
    const env = this.env as SweepEnv;
    const ids: string[] = event.payload?.watchIds?.length
      ? event.payload.watchIds
      : await step.do(
          "list-due-watches",
          { retries: { limit: 3, delay: "10 seconds" } },
          async () => (await listDueSiteWatches(env)).map((w) => w.id),
        );

    const outcomes: WatchOutcome[] = [];
    for (let i = 0; i < ids.length; i += SWEEP_CONCURRENCY) {
      const batch = ids.slice(i, i + SWEEP_CONCURRENCY);
      const settled = await Promise.all(
        batch.map((id) =>
          step
            .do(`sweep-watch-${id}`, {
              retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
              timeout: "10 minutes",
            }, async () => sweepWatch(env, id))
            .then((r) => ({ watch_id: id, ok: true, pages: r.pages }))
            .catch(async (err: unknown) => {
              await recordWatchFailure(env, id, err);
              return { watch_id: id, ok: false, error: String(err) };
            }),
        ),
      );
      outcomes.push(...settled);
    }

    const summary = await step.do(
      "sweep-summary",
      { retries: { limit: 2, delay: "10 seconds" } },
      () => {
        const failed = outcomes.filter((o) => !o.ok).length;
        const changed = outcomes.reduce(
          (n, o) =>
            n + (o.pages ?? []).filter((p) => p.result === "changed").length,
          0,
        );
        env.ENGINE_TELEMETRY?.writeDataPoint({
          blobs: ["sweep", failed > 0 ? "partial" : "clean"],
          doubles: [outcomes.length, changed, failed],
          indexes: ["site-sweep"],
        });
        return Promise.resolve({
          watches: outcomes.length,
          changed,
          failed,
        });
      },
    );
    return { ...summary, outcomes };
  }
}
