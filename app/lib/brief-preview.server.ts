import { env } from "cloudflare:workers";

import { openWeek, type BriefSchedule } from "./brief-schedule";
import type { BriefPayload } from "./brief-payload";
import { rankWeek } from "./standing-score";
import { composeBrief } from "../../workers/standing/compose-brief";
import { PREVIOUS_RANKS, previousRankRows } from "../../workers/standing/freeze";
import { readWeekPicks } from "../../workers/standing/read-this-first";
import { computeWorkspaceScores } from "../../workers/standing/refresh";

const PREVIEW_MARKS = 3;

async function previewStanding(workspaceId: string, weekStartAt: string, weekEndAt: string) {
  const [scores, previous] = await Promise.all([
    computeWorkspaceScores(env.DB, {
      workspaceId,
      weekStartAt,
      windowStartAt: weekStartAt,
      windowEndAt: weekEndAt,
    }),
    env.DB.prepare(PREVIOUS_RANKS).bind(workspaceId, weekStartAt).all(),
  ]);
  const previousRanks = new Map(previousRankRows.parse(previous.results).map((row) => [row.entity_id, row.rank]));
  return rankWeek(
    [...scores].map(([entity_id, score]) => ({ entity_id, score })),
    previousRanks,
  );
}

export async function previewBrief(workspaceId: string, schedule: BriefSchedule, now: Date): Promise<BriefPayload> {
  const week = openWeek(schedule, now);
  const startsAt = week.startsAt.toISOString();
  const closesAt = week.closesAt.toISOString();
  const [standing, picks] = await Promise.all([
    previewStanding(workspaceId, startsAt, closesAt),
    readWeekPicks(env.DB, { workspaceId, startsAt, closesAt }, PREVIEW_MARKS),
  ]);
  const payload = await composeBrief(env.DB, {
    workspaceId,
    schedule,
    week,
    readThisFirst: { picks, judged: picks.length, unjudged: false },
    standing,
  });
  return { ...payload, next_brief_at: closesAt };
}
