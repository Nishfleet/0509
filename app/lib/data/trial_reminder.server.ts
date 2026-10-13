import { z } from "zod";

const SELECT_TRIALS_ENDING = `SELECT p.workspace_id,
       p.tier,
       p.current_period_end,
       p.provider_subscription_id AS subscription_id,
       w.timezone,
       st.id AS target_id,
       st.target_value
  FROM plan p
  JOIN workspace w ON w.id = p.workspace_id
  JOIN send_target st ON st.id = (
    SELECT t.id
      FROM send_target t
      JOIN channel c ON c.id = t.channel_id
     WHERE t.workspace_id = p.workspace_id AND c.key = 'email' AND c.is_enabled = 1 AND t.is_verified = 1
     ORDER BY t.created_at ASC
     LIMIT 1
  )
 WHERE p.trialing = 1 AND p.status = 'active' AND p.current_period_end > ?1 AND p.current_period_end <= ?2`;

const trialEndingRow = z.object({
  workspace_id: z.string(),
  tier: z.string(),
  current_period_end: z.string(),
  subscription_id: z.string().nullable(),
  timezone: z.string(),
  target_id: z.string(),
  target_value: z.string(),
});

export type TrialEnding = z.infer<typeof trialEndingRow>;

const TRIAL_REMINDER_LEAD_MS = 2 * 86_400_000;

export async function readTrialsEnding(db: D1Database, now: Date): Promise<TrialEnding[]> {
  const until = new Date(now.getTime() + TRIAL_REMINDER_LEAD_MS);
  const { results } = await db.prepare(SELECT_TRIALS_ENDING).bind(now.toISOString(), until.toISOString()).all();
  const trials: TrialEnding[] = [];
  for (const row of z.array(z.unknown()).parse(results)) {
    const parsed = trialEndingRow.safeParse(row);
    if (parsed.success) trials.push(parsed.data);
    else console.error(JSON.stringify({ event: "billing.trial_reminder_row_skipped" }));
  }
  return trials;
}

const reminderAttemptRow = z.object({ id: z.string() });

export async function hasReminderAttempt(db: D1Database, key: string): Promise<boolean> {
  return (
    reminderAttemptRow
      .nullable()
      .parse(
        await db
          .prepare("SELECT id FROM send_attempt WHERE idempotency_key = ?1 AND status IN ('sent', 'pending') LIMIT 1")
          .bind(key)
          .first(),
      ) !== null
  );
}

export function trialReminderKey(trial: Pick<TrialEnding, "workspace_id" | "current_period_end">): string {
  return `trial-ending:${trial.workspace_id}:${new Date(trial.current_period_end).toISOString()}`;
}
