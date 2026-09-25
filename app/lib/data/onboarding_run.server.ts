import { env } from "cloudflare:workers";

const INSERT_ONBOARDING_RUN = `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at)
SELECT ?1, ?2, ?3, ?4, ?5
WHERE NOT EXISTS (SELECT 1 FROM onboarding_run WHERE workspace_id = ?2)`;

const UPDATE_CARD_READY_AT = `UPDATE onboarding_run SET card_ready_at = ?2 WHERE workspace_id = ?1 AND card_ready_at IS NULL`;

const UPDATE_COMPETITORS_READY_AT = `UPDATE onboarding_run SET competitors_ready_at = ?2 WHERE workspace_id = ?1 AND competitors_ready_at IS NULL`;

const UPDATE_WATCHING_STARTED_AT = `UPDATE onboarding_run SET watching_started_at = ?2 WHERE workspace_id = ?1 AND watching_started_at IS NULL`;

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

export async function markWatchingStarted(workspaceId: string, at: string): Promise<void> {
  await env.DB.prepare(UPDATE_WATCHING_STARTED_AT).bind(workspaceId, at).run();
}
