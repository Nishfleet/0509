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

const UPDATE_CARD_READY_AT = `UPDATE onboarding_run SET card_ready_at = ?2 WHERE workspace_id = ?1 AND card_ready_at IS NULL`;

const UPDATE_COMPETITORS_READY_AT = `UPDATE onboarding_run SET competitors_ready_at = ?2 WHERE workspace_id = ?1 AND competitors_ready_at IS NULL`;

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

export async function markCardReady(workspaceId: string, at: string): Promise<void> {
  await env.DB.prepare(UPDATE_CARD_READY_AT).bind(workspaceId, at).run();
}

export async function markCompetitorsReady(workspaceId: string, at: string): Promise<void> {
  await env.DB.prepare(UPDATE_COMPETITORS_READY_AT).bind(workspaceId, at).run();
}
