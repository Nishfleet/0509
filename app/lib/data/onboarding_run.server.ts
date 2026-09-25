import { env } from "cloudflare:workers";

const INSERT_ONBOARDING_RUN = `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at)
SELECT ?1, ?2, ?3, ?4, ?5
WHERE NOT EXISTS (SELECT 1 FROM onboarding_run WHERE workspace_id = ?2)`;

const STAMP_FIRST_SIGNALS = `UPDATE onboarding_run
SET first_signal_at = (
  SELECT MIN(s.observed_at) FROM signal s
  WHERE s.workspace_id = onboarding_run.workspace_id AND s.observed_at >= onboarding_run.started_at
)
WHERE first_signal_at IS NULL
  AND EXISTS (
    SELECT 1 FROM signal s
    WHERE s.workspace_id = onboarding_run.workspace_id AND s.observed_at >= onboarding_run.started_at
  )`;

export async function stampFirstSignals(db: D1Database): Promise<void> {
  await db.prepare(STAMP_FIRST_SIGNALS).run();
}

export async function startOnboardingRun(input: {
  workspaceId: string;
  userId: string;
  inputRaw: string;
  startedAt: string;
}): Promise<void> {
  await env.DB.prepare(INSERT_ONBOARDING_RUN)
    .bind(crypto.randomUUID(), input.workspaceId, input.userId, input.inputRaw, input.startedAt)
    .run();
}
