import { env } from "cloudflare:workers";
import { z } from "zod";

import type { RetentionBoard } from "../retention-board";

const FUNNEL = `SELECT date(w.created_at, 'weekday 0', '-6 days') AS week,
       count(*) AS signed_up,
       sum(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS started,
       sum(CASE WHEN p.status IN ('active', 'trialing') AND p.trialing = 1 THEN 1 ELSE 0 END) AS trialing,
       sum(CASE WHEN p.status IN ('active', 'past_due') AND p.trialing = 0 THEN 1 ELSE 0 END) AS paying,
       sum(CASE WHEN p.status IN ('cancelled', 'expired') THEN 1 ELSE 0 END) AS cancelled
  FROM workspace w
  LEFT JOIN plan p ON p.workspace_id = w.id
 WHERE w.created_at >= ?1 AND w.fixture = 0
 GROUP BY week
 ORDER BY week DESC`;

const LAST_SEEN = `SELECT CASE
         WHEN w.last_seen_at IS NULL THEN 'never'
         WHEN julianday(?1) - julianday(w.last_seen_at) <= 7 THEN 'week'
         WHEN julianday(?1) - julianday(w.last_seen_at) < 21 THEN 'drifting'
         ELSE 'away'
       END AS bucket,
       count(*) AS workspaces
  FROM workspace w
  JOIN plan p ON p.workspace_id = w.id
   AND (p.status IN ('trialing', 'active', 'past_due')
        OR (p.status = 'cancelled' AND p.current_period_end > ?1))
 WHERE w.fixture = 0
 GROUP BY bucket`;

const CANCELLATIONS = `SELECT substr(p.updated_at, 1, 7) AS month, count(*) AS cancelled
  FROM plan p
  JOIN workspace w ON w.id = p.workspace_id AND w.fixture = 0
 WHERE p.status IN ('cancelled', 'expired') AND p.updated_at >= ?1
 GROUP BY month
 ORDER BY month DESC`;

const EMAIL_TO_VISIT = `SELECT substr(a.idempotency_key, 1, instr(a.idempotency_key, ':') - 1) AS kind,
       count(*) AS sent,
       sum(EXISTS (
         SELECT 1 FROM workspace_visit v
          WHERE v.workspace_id = a.workspace_id
            AND v.day BETWEEN date(a.attempted_at) AND date(a.attempted_at, '+1 day')
       )) AS visited
  FROM send_attempt a
  JOIN workspace w ON w.id = a.workspace_id AND w.fixture = 0
 WHERE a.status = 'sent' AND a.attempted_at >= ?1 AND instr(a.idempotency_key, ':') > 1
 GROUP BY kind
 ORDER BY sent DESC`;

const funnelRow = z.object({
  week: z.string(),
  signed_up: z.number(),
  started: z.number(),
  trialing: z.number(),
  paying: z.number(),
  cancelled: z.number(),
});

const lastSeenRow = z.object({ bucket: z.enum(["week", "drifting", "away", "never"]), workspaces: z.number() });

const cancellationRow = z.object({ month: z.string(), cancelled: z.number() });

const emailRow = z.object({ kind: z.string(), sent: z.number(), visited: z.number() });

const DAY_MS = 86_400_000;
const FUNNEL_WEEKS = 8;
const CANCEL_DAYS = 120;
const EMAIL_DAYS = 30;

function since(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function parseRows<Schema extends z.ZodType>(schema: Schema, results: readonly unknown[]): z.infer<Schema>[] {
  return z.array(schema).parse(results);
}

export async function readRetentionBoard(now: Date): Promise<RetentionBoard> {
  const db = env.DB;
  const [funnel, lastSeen, cancellations, emails] = await db.batch([
    db.prepare(FUNNEL).bind(since(now, FUNNEL_WEEKS * 7)),
    db.prepare(LAST_SEEN).bind(now.toISOString()),
    db.prepare(CANCELLATIONS).bind(since(now, CANCEL_DAYS)),
    db.prepare(EMAIL_TO_VISIT).bind(since(now, EMAIL_DAYS)),
  ]);
  const buckets = { week: 0, drifting: 0, away: 0, never: 0 };
  for (const row of parseRows(lastSeenRow, lastSeen?.results ?? [])) buckets[row.bucket] = row.workspaces;
  return {
    funnel: parseRows(funnelRow, funnel?.results ?? []),
    lastSeen: buckets,
    cancellations: parseRows(cancellationRow, cancellations?.results ?? []),
    emails: parseRows(emailRow, emails?.results ?? []),
  };
}
