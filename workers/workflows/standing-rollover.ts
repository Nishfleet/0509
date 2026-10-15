import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { holdDeadlinePassed, weekSendable } from "../../app/lib/customer-ready";
import { instantStamp, nextBriefAt, rolloverInstance, weekClosingAt } from "../../app/lib/brief-schedule";
import type { RolloverParams } from "../../app/lib/brief-schedule";
import { briefSubject } from "../../app/lib/brief-subject";
import { insertWeeklyDigest, listBriefs } from "../../app/lib/data/digest.server";
import { JevRateLimitedError } from "../../app/lib/jev/client.server";
import { rejudgeUnjudgedChanges } from "../../app/lib/site/judge.server";
import { composeBrief } from "../standing/compose-brief";
import { freezeWeek } from "../standing/freeze";
import { judgeWeek, type JudgedWeek } from "../standing/read-this-first";
import { refreshWorkspaceScores } from "../standing/refresh";
import { createRollovers, readWorkspaceSchedule } from "../standing/rollover-plan";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
};

export interface RolloverOutcome {
  workspaceId: string;
  closesAt: string;
  digestId: string | null;
  skipped:
    | "workspace_gone"
    | "schedule_moved"
    | "already_briefed"
    | "nothing_to_compare"
    | "brief_paused"
    | "held_unjudged"
    | null;
}

interface ClosingWeek {
  timezone: string;
  weekday: number;
  hour: number;
  startsAt: string;
  paused: boolean;
}

const WEEK_TOLERANCE_MS = 6 * 24 * 60 * 60 * 1000;

async function alreadyBriefed(db: D1Database, workspaceId: string, closesAt: Date): Promise<boolean> {
  const floor = closesAt.getTime() - WEEK_TOLERANCE_MS;
  return (await listBriefs(db, workspaceId)).some((brief) => new Date(brief.period_end).getTime() > floor);
}

async function scoreClosingWeek(
  db: D1Database,
  workspaceId: string,
  closesAt: Date,
): Promise<ClosingWeek | "workspace_gone" | "schedule_moved" | "already_briefed"> {
  const workspace = await readWorkspaceSchedule(db, workspaceId);
  if (workspace === null) return "workspace_gone";
  const due = nextBriefAt(workspace.schedule, new Date(closesAt.getTime() - 1));
  if (due.getTime() !== closesAt.getTime()) return "schedule_moved";
  if (await alreadyBriefed(db, workspaceId, closesAt)) return "already_briefed";
  const week = weekClosingAt(workspace.schedule, closesAt);
  const startsAt = week.startsAt.toISOString();
  await refreshWorkspaceScores(db, {
    workspaceId,
    weekStartAt: startsAt,
    windowStartAt: startsAt,
    windowEndAt: closesAt.toISOString(),
    computedAt: new Date().toISOString(),
  });
  return { ...workspace.schedule, startsAt, paused: workspace.briefPausedAt !== null };
}

async function writeDigest(
  env: Env,
  week: { workspaceId: string; closesAt: Date; closing: ClosingWeek; readThisFirst: JudgedWeek },
): Promise<string> {
  const { workspaceId, closesAt, closing, readThisFirst } = week;
  const schedule = { timezone: closing.timezone, weekday: closing.weekday, hour: closing.hour };
  const id = `digest_${workspaceId}_${instantStamp(closesAt)}`;
  const payload = await composeBrief(env.DB, {
    workspaceId,
    schedule,
    week: { startsAt: new Date(closing.startsAt), closesAt },
    readThisFirst,
  });
  await insertWeeklyDigest(env.DB, {
    id,
    workspaceId,
    periodStart: payload.period_start,
    periodEnd: payload.period_end,
    status: closing.paused ? "paused" : "pending",
    payloadJson: JSON.stringify(payload),
    subject: briefSubject(payload),
  });
  if (!closing.paused) await env.SEND_EMAIL.send({ digest_id: id });
  return id;
}

async function rejudgeClosingWeek(
  step: WorkflowStep,
  input: { workspaceId: string; startsAt: string; closesAt: string },
): Promise<void> {
  try {
    await step.do("rejudge-changes", RETRY, () =>
      rejudgeUnjudgedChanges({
        workspaceId: input.workspaceId,
        windowStartAt: input.startsAt,
        windowEndAt: input.closesAt,
      }),
    );
  } catch (error) {
    if (!(error instanceof JevRateLimitedError)) throw error;
    console.error(JSON.stringify({ event: "standing.rejudge_failed", workspaceId: input.workspaceId }));
  }
}

function refreshClosingWeek(
  step: WorkflowStep,
  input: { db: D1Database; workspaceId: string; startsAt: string; closesAt: string },
): Promise<void> {
  return step.do("refresh-scores", RETRY, async () => {
    await refreshWorkspaceScores(input.db, {
      workspaceId: input.workspaceId,
      weekStartAt: input.startsAt,
      windowStartAt: input.startsAt,
      windowEndAt: input.closesAt,
      computedAt: new Date().toISOString(),
    });
  });
}

function freezeClosingWeek(
  step: WorkflowStep,
  input: { db: D1Database; workspaceId: string; startsAt: string; closesAt: string },
): Promise<number> {
  return step.do("freeze-rank", RETRY, async () => {
    const ranked = await freezeWeek(input.db, {
      workspaceId: input.workspaceId,
      weekStartAt: input.startsAt,
      weekEndAt: input.closesAt,
    });
    return ranked.length;
  });
}

function pausedSkip(paused: boolean): RolloverOutcome["skipped"] {
  return paused ? "brief_paused" : null;
}

function isSendable(readThisFirst: JudgedWeek, closesAt: Date): boolean {
  return weekSendable({
    unjudgedInputs: readThisFirst.unjudged ? 1 : 0,
    holdDeadlinePassed: holdDeadlinePassed(closesAt, new Date()),
  });
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

    const exists = () => readWorkspaceSchedule(this.env.DB, workspaceId).then((workspace) => workspace !== null);
    if (!(await step.do("workspace-exists", RETRY, exists))) return outcome(null, "workspace_gone");

    if (closesAt.getTime() > Date.now()) {
      await step.sleepUntil("until-brief", closesAt);
    }

    const closing = await step.do("final-score", RETRY, () => scoreClosingWeek(this.env.DB, workspaceId, closesAt));
    if (typeof closing === "string") return outcome(null, closing);

    const schedule = { timezone: closing.timezone, weekday: closing.weekday, hour: closing.hour };
    const week = {
      db: this.env.DB,
      workspaceId,
      startsAt: closing.startsAt,
      closesAt: closesAt.toISOString(),
    };
    await rejudgeClosingWeek(step, week);
    await refreshClosingWeek(step, week);
    const rankedCount = await freezeClosingWeek(step, week);

    const readThisFirst = await step.do("read-this-first", RETRY, async () =>
      judgeWeek(this.env.DB, {
        workspaceId,
        startsAt: closing.startsAt,
        closesAt: closesAt.toISOString(),
        decidedAt: new Date().toISOString(),
      }),
    );

    const sendable = isSendable(readThisFirst, closesAt);
    const digestId =
      !sendable || (rankedCount < 2 && !readThisFirst.unjudged)
        ? null
        : await step.do("write-digest", RETRY, () =>
            writeDigest(this.env, { workspaceId, closesAt, closing, readThisFirst }),
          );

    await step.do("spawn-successor", RETRY, async () =>
      createRollovers(this.env.STANDING_ROLLOVER, [
        rolloverInstance(workspaceId, nextBriefAt(schedule, closesAt), "scheduled"),
      ]),
    );

    if (!sendable) return outcome(null, "held_unjudged");
    return digestId === null ? outcome(null, "nothing_to_compare") : outcome(digestId, pausedSkip(closing.paused));
  }
}
