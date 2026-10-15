import { z } from "zod";

import type { ActivationBoard } from "../activation-board";

const COHORTS = `WITH first_brief AS (
  SELECT workspace_id, MIN(sent_at) AS at FROM digest
   WHERE kind = 'weekly' AND status = 'sent' AND sent_at IS NOT NULL GROUP BY workspace_id
), steps AS (
  SELECT date(w.created_at, 'weekday 0', '-6 days') AS week,
         EXISTS (SELECT 1 FROM entity e WHERE e.workspace_id = w.id AND e.role = 'competitor' AND e.state = 'on') AS watching,
         fb.at IS NOT NULL AS briefed,
         (fb.at IS NOT NULL AND EXISTS (SELECT 1 FROM workspace_visit v WHERE v.workspace_id = w.id AND v.day >= date(fb.at))) AS came_back,
         (EXISTS (SELECT 1 FROM user_decision d WHERE d.workspace_id = w.id)
          OR EXISTS (SELECT 1 FROM entity e WHERE e.workspace_id = w.id AND e.role = 'competitor'
                       AND e.created_at >= datetime(w.created_at, '+1 day'))) AS did_something
    FROM workspace w LEFT JOIN first_brief fb ON fb.workspace_id = w.id
   WHERE w.created_at >= ?1 AND w.fixture = 0
)
SELECT week, count(*) AS signed_up, sum(watching) AS watching, sum(briefed) AS briefed,
       sum(came_back) AS came_back, sum(came_back AND did_something) AS activated
  FROM steps GROUP BY week ORDER BY week DESC`;

const AT_RISK = `WITH latest_brief AS (
  SELECT d.workspace_id, d.sent_at AS at, d.status FROM digest d
   WHERE d.kind = 'weekly' AND d.sent_at IS NOT NULL
     AND d.sent_at = (SELECT MAX(x.sent_at) FROM digest x WHERE x.workspace_id = d.workspace_id AND x.kind = 'weekly')
), flags AS (
  SELECT w.id,
         (w.last_seen_at IS NULL OR julianday(?1) - julianday(w.last_seen_at) >= 14) AS unseen,
         (lb.at IS NOT NULL AND lb.status = 'sent' AND julianday(?1) - julianday(lb.at) >= 2
          AND NOT EXISTS (SELECT 1 FROM workspace_visit v WHERE v.workspace_id = w.id AND v.day >= date(lb.at))) AS unopened_brief,
         (w.brief_paused_at IS NOT NULL) AS paused,
         ((SELECT count(*) FROM entity e WHERE e.workspace_id = w.id AND e.role = 'competitor' AND e.state = 'on') < 2) AS few_rivals,
         ((SELECT count(*) FROM user_decision d WHERE d.workspace_id = w.id AND d.verdict = 'change_feedback:not_useful' AND d.decided_at >= ?2) >= 3
          AND NOT EXISTS (SELECT 1 FROM user_decision d WHERE d.workspace_id = w.id AND d.verdict = 'change_feedback:useful' AND d.decided_at >= ?2)) AS unhappy,
         (COALESCE(lb.status = 'failed', 0)
          OR EXISTS (SELECT 1 FROM send_target t JOIN email_suppression s ON s.address = lower(t.target_value)
                      WHERE t.workspace_id = w.id AND t.role = 'owner')) AS unreachable
    FROM workspace w
    JOIN plan p ON p.workspace_id = w.id
     AND (p.status IN ('trialing', 'active', 'past_due') OR (p.status = 'cancelled' AND p.current_period_end > ?1))
    LEFT JOIN latest_brief lb ON lb.workspace_id = w.id
   WHERE w.fixture = 0
)
SELECT count(*) AS live, COALESCE(sum(unseen), 0) AS unseen, COALESCE(sum(unopened_brief), 0) AS unopened_brief,
       COALESCE(sum(paused), 0) AS paused, COALESCE(sum(few_rivals), 0) AS few_rivals,
       COALESCE(sum(unhappy), 0) AS unhappy, COALESCE(sum(unreachable), 0) AS unreachable,
       COALESCE(sum((unseen + unopened_brief + paused + few_rivals + unhappy + unreachable) >= 1), 0) AS any,
       COALESCE(sum((unseen + unopened_brief + paused + few_rivals + unhappy + unreachable) >= 2), 0) AS two_or_more
  FROM flags`;

const cohortRow = z.object({
  week: z.string(),
  signed_up: z.number(),
  watching: z.number(),
  briefed: z.number(),
  came_back: z.number(),
  activated: z.number(),
});

const atRiskRow = z.object({
  live: z.number(),
  unseen: z.number(),
  unopened_brief: z.number(),
  paused: z.number(),
  few_rivals: z.number(),
  unhappy: z.number(),
  unreachable: z.number(),
  any: z.number(),
  two_or_more: z.number(),
});

const DAY_MS = 86_400_000;
const COHORT_WEEKS = 8;
const FEEDBACK_DAYS = 30;

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function readActivationBoard(db: D1Database, now: Date): Promise<ActivationBoard> {
  const [cohorts, atRisk] = await db.batch([
    db.prepare(COHORTS).bind(daysBefore(now, COHORT_WEEKS * 7)),
    db.prepare(AT_RISK).bind(now.toISOString(), daysBefore(now, FEEDBACK_DAYS)),
  ]);
  return {
    cohorts: z.array(cohortRow).parse(cohorts?.results ?? []),
    atRisk: atRiskRow.parse(atRisk?.results[0]),
  };
}
