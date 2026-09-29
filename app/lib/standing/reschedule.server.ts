import { env } from "cloudflare:workers";

import type { BriefSchedule } from "../brief-schedule";
import { listBriefs } from "../data/digest.server";
import { updateBriefSchedule } from "../data/workspace.server";
import { rescheduleRollover } from "./reschedule";
import type { RescheduleResult } from "./reschedule";

export async function saveBriefSchedule(
  workspaceId: string,
  previous: BriefSchedule,
  next: BriefSchedule,
): Promise<RescheduleResult> {
  await updateBriefSchedule(workspaceId, next);
  const latest = (await listBriefs(env.DB, workspaceId))[0];
  const lastBriefPeriodEnd = latest === undefined ? null : new Date(latest.period_end);
  return rescheduleRollover(env.STANDING_ROLLOVER, {
    workspaceId,
    previous,
    next,
    now: new Date(),
    lastBriefPeriodEnd,
  });
}
