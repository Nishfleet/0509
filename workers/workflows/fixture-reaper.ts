import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { ReaperReport } from "../../app/lib/fixture-reaper.server";
import { reapFixtureAccounts } from "../../app/lib/fixture-reaper.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

export class FixtureReaper extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<ReaperReport> {
    const raw = await step.do("mode", RETRY, () => Promise.resolve(this.env.FIXTURE_REAPER));
    return reapFixtureAccounts(raw, event.timestamp, (name, work) => step.do(name, RETRY, work));
  }
}
