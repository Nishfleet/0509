import { env } from "cloudflare:workers";

import type { BriefSchedule } from "../brief-schedule";
import { updateBriefSchedule } from "../data/workspace.server";
import { rescheduleRollover } from "./reschedule";
import type { RescheduleResult } from "./reschedule";

export async function saveBriefSchedule(
  workspaceId: string,
  previous: BriefSchedule,
  next: BriefSchedule,
): Promise<RescheduleResult> {
  await updateBriefSchedule(workspaceId, next);
  return rescheduleRollover(env.STANDING_ROLLOVER, { workspaceId, previous, next, now: new Date() });
}
