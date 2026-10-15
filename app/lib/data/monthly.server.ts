import { z } from "zod";
import { APP_LOCALE } from "../locale";
import { SENDABLE_SIGNALS } from "../customer-ready";

const SELECT_MONTHLIES = `SELECT w.id AS workspace_id,
       p.provider_subscription_id AS subscription_id,
       st.id AS target_id,
       st.target_value,
       st.unsubscribe_token,
       (SELECT count(*) FROM ${SENDABLE_SIGNALS} s
          JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
         WHERE s.workspace_id = w.id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
           AND s.observed_at >= ?1 AND s.observed_at < ?2) AS change_count,
       (SELECT json_group_array(json_object('rival', rival, 'what', what))
          FROM (SELECT COALESCE(NULLIF(e.name, ''), e.domain) AS rival,
                       COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')) AS what
                  FROM ${SENDABLE_SIGNALS} s
                  JOIN entity e ON e.id = s.entity_id AND e.workspace_id = s.workspace_id AND e.role = 'competitor' AND e.state = 'on'
                 WHERE s.workspace_id = w.id AND s.kind = 'change' AND s.is_tombstoned = 0 AND s.duplicate_of IS NULL
                   AND COALESCE(NULLIF(s.title, ''), NULLIF(s.summary, '')) IS NOT NULL
                   AND s.observed_at >= ?1 AND s.observed_at < ?2
                 ORDER BY s.observed_at DESC
                 LIMIT 3)) AS moves
  FROM workspace w
  JOIN plan p ON p.workspace_id = w.id AND p.status = 'active' AND p.trialing = 0
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = w.id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1 AND t.role = 'owner'
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE w.brief_paused_at IS NULL AND w.last_seen_at IS NOT NULL AND w.last_seen_at > ?3`;

const moveRow = z.object({ rival: z.string(), what: z.string() });

function parseMoves(json: string, ctx: z.RefinementCtx): z.infer<typeof moveRow>[] {
  try {
    const parsed = z.array(moveRow).safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    ctx.addIssue({ code: "custom", message: "moves is not JSON" });
    return z.NEVER;
  }
  ctx.addIssue({ code: "custom", message: "a move has no name or title" });
  return z.NEVER;
}

const monthlyRow = z.object({
  workspace_id: z.string(),
  subscription_id: z.string().nullable(),
  target_id: z.string(),
  target_value: z.string(),
  unsubscribe_token: z.string().nullable(),
  change_count: z.number(),
  moves: z.string().transform(parseMoves),
});

export type Monthly = z.infer<typeof monthlyRow> & { month: string; key: string };

const DAY_MS = 86_400_000;
const AWAY_DAYS = 21;
const SEND_FROM_DAY = 3;
const SEND_UNTIL_DAY = 9;

const MONTH_NAME = new Intl.DateTimeFormat(APP_LOCALE, { month: "long", timeZone: "UTC" });

function previousMonth(now: Date): { from: Date; to: Date; label: string; key: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { from, to, label: MONTH_NAME.format(from), key: from.toISOString().slice(0, 7) };
}

function isMonthlyWindow(now: Date): boolean {
  const day = now.getUTCDate();
  return day >= SEND_FROM_DAY && day <= SEND_UNTIL_DAY;
}

export async function readMonthlies(db: D1Database, now: Date): Promise<Monthly[]> {
  if (!isMonthlyWindow(now)) return [];
  const month = previousMonth(now);
  const stillHere = new Date(now.getTime() - AWAY_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(SELECT_MONTHLIES)
    .bind(month.from.toISOString(), month.to.toISOString(), stillHere)
    .all();
  const monthlies: Monthly[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = monthlyRow.safeParse(row);
    if (parsed.success)
      monthlies.push({ ...parsed.data, month: month.label, key: `monthly:${parsed.data.workspace_id}:${month.key}` });
    else console.error(JSON.stringify({ event: "delivery.monthly_row_skipped" }));
  }
  return monthlies;
}
