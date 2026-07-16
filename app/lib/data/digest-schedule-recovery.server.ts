import { queryOne as one } from "~/lib/data/d1.server";
import { createId, jsonValue, nowIso, parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

const ACTION_NAME = "ops.digest_schedule_job.requeue";

interface AuditRow {
  status: string;
  result_json: string | null;
}

export function createDigestScheduleJobRequeueKey() {
  return `digest-schedule-requeue:${crypto.randomUUID()}`;
}

export async function requeueExhaustedDigestScheduleJobWithAudit(
  env: AppEnv,
  input: {
    operatorUserId: string;
    jobId: string;
    expectedUpdatedAt: string;
    idempotencyKey: string;
  },
) {
  const operatorUserId = input.operatorUserId.trim();
  const jobId = input.jobId.trim();
  const expectedUpdatedAt = input.expectedUpdatedAt.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!operatorUserId || !jobId || !expectedUpdatedAt || !idempotencyKey) {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (!env.DB || typeof env.DB.batch !== "function") {
    throw new Error("Atomic D1 batch support is required for digest schedule recovery.");
  }

  const auditId = createId();
  const requeuedAt = nowIso();
  const result = { jobId, requeuedAt };
  const insertAudit = env.DB.prepare(
    `INSERT OR IGNORE INTO agent_action_audit (
       id, user_id, api_key_id, action_name, resource_type, resource_id,
       idempotency_key, status, result_json, error_code, error_message,
       metadata_json, created_at, updated_at
     )
     SELECT ?, ?, NULL, ?, 'digest_schedule_job', digest_schedule_job.id,
       ?, 'succeeded', ?, NULL, NULL, ?, ?, ?
     FROM digest_schedule_job
     WHERE digest_schedule_job.id = ?
       AND digest_schedule_job.status = 'exhausted'
       AND digest_schedule_job.updated_at = ?`,
  ).bind(
    auditId,
    operatorUserId,
    ACTION_NAME,
    idempotencyKey,
    jsonValue(result),
    jsonValue({ recoveryMode: "operator_cas_requeue" }),
    requeuedAt,
    requeuedAt,
    jobId,
    expectedUpdatedAt,
  );
  const updateJob = env.DB.prepare(
    `UPDATE digest_schedule_job
     SET status = 'pending',
         attempt_count = 0,
         processing_token = NULL,
         processing_started_at = NULL,
         completed_at = NULL,
         last_error_code = 'operator_requeue',
         exhausted_at = NULL,
         exhaustion_alert_token = NULL,
         exhaustion_alert_started_at = NULL,
         exhaustion_alerted_at = NULL,
         updated_at = ?
     WHERE id = ?
       AND status = 'exhausted'
       AND updated_at = ?
       AND EXISTS (
         SELECT 1 FROM agent_action_audit
         WHERE agent_action_audit.id = ?
           AND agent_action_audit.status = 'succeeded'
       )`,
  ).bind(requeuedAt, jobId, expectedUpdatedAt, auditId);

  const batch = await env.DB.batch([insertAudit, updateJob]);
  const auditCreated = Number(batch[0]?.meta?.changes ?? 0) === 1;
  const jobUpdated = Number(batch[1]?.meta?.changes ?? 0) === 1;
  if (auditCreated && jobUpdated) {
    return { ok: true as const, replayed: false, ...result };
  }
  if (auditCreated !== jobUpdated) {
    throw new Error("Digest schedule recovery audit/effect integrity check failed.");
  }

  const existingAudit = await one<AuditRow>(
    env,
    `SELECT status, result_json FROM agent_action_audit
     WHERE user_id = ? AND idempotency_key = ?
     LIMIT 1`,
    operatorUserId,
    idempotencyKey,
  );
  const prior = parseJson<Record<string, unknown> | null>(existingAudit?.result_json, null);
  if (existingAudit?.status === "succeeded" && prior?.jobId === jobId) {
    return {
      ok: true as const,
      replayed: true,
      jobId,
      requeuedAt: typeof prior.requeuedAt === "string" ? prior.requeuedAt : requeuedAt,
    };
  }
  if (existingAudit) {
    return { ok: false as const, reason: "idempotency_conflict" as const };
  }
  const job = await one<{ id: string }>(
    env,
    "SELECT id FROM digest_schedule_job WHERE id = ? LIMIT 1",
    jobId,
  );
  return job
    ? { ok: false as const, reason: "stale" as const }
    : { ok: false as const, reason: "not_found" as const };
}
