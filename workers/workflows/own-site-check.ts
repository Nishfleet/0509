import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { withMonitor } from "@sentry/cloudflare";

import type { OwnSitePage } from "../../app/lib/data/page.server";
import type { OwnSiteHealth } from "../../app/lib/site/own-site.server";
import {
  breakageRepaired,
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

const MONITOR = {
  schedule: { type: "crontab", value: "0 * * * *" },
  checkinMargin: 15,
  timezone: "UTC",
} as const;

export interface OwnSiteCheckOutcome {
  pages: number;
  opened: number;
  closed: number;
  failed: number;
}

interface Probed {
  page: OwnSitePage;
  health: OwnSiteHealth | null;
}

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "site.own_check_step_failed",
        step: label,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

export class OwnSiteCheck extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<OwnSiteCheckOutcome> {
    return withMonitor("own-site-check", () => this.runCheck(event, step), MONITOR);
  }

  private async runCheck(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<OwnSiteCheckOutcome> {
    const plannedAt = event.timestamp.toISOString();
    const plan = await step.do("plan", RETRY, () => planOwnSiteCheck(plannedAt));

    const probed = await plan.pages.reduce<Promise<readonly Probed[]>>(async (done, page) => {
      const previous = await done;
      const label = `probe ${page.pageId}`;
      const health = await settle(label, () => step.do(label, RETRY, () => probeOwnSite(page.url)));
      return [...previous, { page, health }];
    }, Promise.resolve([]));

    const recovered = await probed.reduce<Promise<readonly string[]>>(async (done, { page, health }) => {
      const previous = await done;
      const incidentId = plan.openIncidents[page.pageId];
      if (health?.state !== "healthy" || incidentId === undefined) return previous;
      if (!Object.hasOwn(plan.breakage, page.pageId)) return [...previous, incidentId];
      const label = `verify ${incidentId}`;
      const repaired = await settle(label, () =>
        step.do(label, RETRY, () => breakageRepaired(page.url, plan.breakage[page.pageId] ?? null)),
      );
      return repaired === true ? [...previous, incidentId] : previous;
    }, Promise.resolve([]));
    const closed = await recovered.reduce<Promise<number>>(async (done, incidentId) => {
      const count = await done;
      const label = `close ${incidentId}`;
      const result = await settle(label, () =>
        step.do(label, RETRY, async () => {
          await closeOwnSiteIncident(incidentId);
          return incidentId;
        }),
      );
      return result === null ? count : count + 1;
    }, Promise.resolve(0));

    const suspects = probed.filter(
      ({ page, health }) => health?.state === "broken" && plan.openIncidents[page.pageId] === undefined,
    );
    if (suspects.length > 0) await step.sleep("confirm", CONFIRM_AFTER);

    const opened = await suspects.reduce<Promise<number>>(async (done, { page }) => {
      const count = await done;
      const confirmLabel = `confirm ${page.pageId}`;
      const confirmed = await settle(confirmLabel, () => step.do(confirmLabel, RETRY, () => probeOwnSite(page.url)));
      if (confirmed?.state !== "broken") return count;
      const openLabel = `open ${page.pageId}`;
      const incidentId = await settle(openLabel, () =>
        step.do(openLabel, RETRY, () => openOwnSiteIncident(page, confirmed.kind)),
      );
      return incidentId === null ? count : count + 1;
    }, Promise.resolve(0));

    const summary: OwnSiteCheckOutcome = {
      pages: probed.length,
      opened,
      closed,
      failed: probed.filter(({ health }) => health === null).length,
    };
    console.log(JSON.stringify({ event: "site.own_check", ...summary }));
    return summary;
  }
}
