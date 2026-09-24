import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { SiteSweepTarget } from "../../app/lib/data/watch.server";
import type { OwnSiteHealth } from "../../app/lib/site/own-site.server";
import {
  closeOwnSiteIncident,
  openOwnSiteIncident,
  planOwnSiteCheck,
  probeOwnSite,
} from "../../app/lib/site/own-site.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const CONFIRM_AFTER = "5 minutes";

export interface OwnSiteCheckOutcome {
  pages: number;
  opened: number;
  closed: number;
}

interface Probed {
  target: SiteSweepTarget;
  health: OwnSiteHealth;
}

export class OwnSiteCheck extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<OwnSiteCheckOutcome> {
    const plannedAt = event.timestamp.toISOString();
    const plan = await step.do("plan", RETRY, () => planOwnSiteCheck(plannedAt));

    const probed = await plan.pages.reduce<Promise<readonly Probed[]>>(async (done, target) => {
      const previous = await done;
      const health = await step.do(`probe ${target.pageId}`, RETRY, () => probeOwnSite(target.url));
      return [...previous, { target, health }];
    }, Promise.resolve([]));

    const recovered = probed.flatMap(({ target, health }) => {
      const incidentId = plan.openIncidents[target.pageId];
      return health.healthy && incidentId !== undefined ? [incidentId] : [];
    });
    await recovered.reduce(async (done, incidentId) => {
      await done;
      await step.do(`close ${incidentId}`, RETRY, () => closeOwnSiteIncident(incidentId));
    }, Promise.resolve());

    const suspects = probed.filter(
      ({ target, health }) => !health.healthy && plan.openIncidents[target.pageId] === undefined,
    );
    if (suspects.length > 0) await step.sleep("confirm", CONFIRM_AFTER);

    const opened = await suspects.reduce<Promise<number>>(async (done, { target }) => {
      const count = await done;
      const confirmed = await step.do(`confirm ${target.pageId}`, RETRY, async () => {
        const health = await probeOwnSite(target.url);
        return health.healthy ? null : openOwnSiteIncident(target, health.kind);
      });
      return confirmed === null ? count : count + 1;
    }, Promise.resolve(0));

    const summary: OwnSiteCheckOutcome = { pages: probed.length, opened, closed: recovered.length };
    console.log(JSON.stringify({ event: "site.own_check", ...summary }));
    return summary;
  }
}
