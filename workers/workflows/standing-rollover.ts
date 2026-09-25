import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { instantStamp, nextBriefAt, rolloverInstance, weekClosingAt } from "../../app/lib/brief-schedule";
import type { RolloverParams } from "../../app/lib/brief-schedule";
import { insertWeeklyDigest } from "../../app/lib/data/digest.server";
import { composeBrief } from "../standing/compose-brief";
import { freezeWeek } from "../standing/freeze";
import { refreshWorkspaceScores } from "../standing/refresh";
import { createRollovers, readWorkspaceSchedule } from "../standing/rollover-plan";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
};

export interface RolloverOutcome {
  workspaceId: string;
  closesAt: string;
  digestId: string | null;
  skipped: "workspace_gone" | "schedule_moved" | "nothing_to_compare" | "brief_paused" | null;
}

interface ClosingWeek {
  timezone: string;
  weekday: number;
  hour: number;
  startsAt: string;
  paused: boolean;
}

export class StandingRollover extends WorkflowEntrypoint<Env, RolloverParams> {
  async run(event: WorkflowEvent<RolloverParams>, step: WorkflowStep): Promise<RolloverOutcome> {
    const { workspaceId } = event.payload;
    const closesAt = new Date(event.payload.closesAt);
    const outcome = (digestId: string | null, skipped: RolloverOutcome["skipped"]): RolloverOutcome => ({
      workspaceId,
      closesAt: closesAt.toISOString(),
      digestId,
      skipped,
    });

    if (closesAt.getTime() > Date.now()) {
      await step.sleepUntil("until-brief", closesAt);
    }

    const closing = await step.do("final-score", RETRY, async (): Promise<ClosingWeek | "workspace_gone" | "schedule_moved"> => {
      const workspace = await readWorkspaceSchedule(this.env.DB, workspaceId);
      if (workspace === null) return "workspace_gone";
      const due = nextBriefAt(workspace.schedule, new Date(closesAt.getTime() - 1));
      if (due.getTime() !== closesAt.getTime()) return "schedule_moved";
      const week = weekClosingAt(workspace.schedule, closesAt);
      const startsAt = week.startsAt.toISOString();
      await refreshWorkspaceScores(this.env.DB, {
        workspaceId,
        weekStartAt: startsAt,
        windowStartAt: startsAt,
        windowEndAt: closesAt.toISOString(),
        computedAt: new Date().toISOString(),
      });
      return { ...workspace.schedule, startsAt, paused: workspace.briefPausedAt !== null };
    });
    if (closing === "workspace_gone" || closing === "schedule_moved") return outcome(null, closing);

    const schedule = { timezone: closing.timezone, weekday: closing.weekday, hour: closing.hour };

    const rankedCount = await step.do("freeze-rank", RETRY, async () => {
      const ranked = await freezeWeek(this.env.DB, workspaceId, closing.startsAt);
      return ranked.length;
    });

    const writeDigest = async (): Promise<string> => {
      const id = `digest_${workspaceId}_${instantStamp(closesAt)}`;
      const payload = await composeBrief(this.env.DB, {
        workspaceId,
        schedule,
        week: { startsAt: new Date(closing.startsAt), closesAt },
      });
      await insertWeeklyDigest(this.env.DB, {
        id,
        workspaceId,
        periodStart: payload.period_start,
        periodEnd: payload.period_end,
        status: closing.paused ? "paused" : "pending",
        payloadJson: JSON.stringify(payload),
      });
      if (!closing.paused) await this.env.SEND_EMAIL.send({ digest_id: id });
      return id;
    };
    const digestId = rankedCount < 2 ? null : await step.do("write-digest", RETRY, writeDigest);

    await step.do("spawn-successor", RETRY, async () =>
      createRollovers(this.env.STANDING_ROLLOVER, [
        rolloverInstance(workspaceId, nextBriefAt(schedule, closesAt), "scheduled"),
      ]),
    );

    if (digestId === null) return outcome(null, "nothing_to_compare");
    return outcome(digestId, closing.paused ? "brief_paused" : null);
  }
}
