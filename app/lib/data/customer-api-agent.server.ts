/**
 * Customer API agent-action audit persistence (D1).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` only
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  AgentActionAuditRecord,
  AgentActionAuditStatus,
} from "~/lib/types";

interface AgentActionAuditRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  action_name: string;
  resource_type: string | null;
  resource_id: string | null;
  idempotency_key: string | null;
  status: AgentActionAuditStatus;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function toAgentActionAuditRecord(row: AgentActionAuditRow): AgentActionAuditRecord {
  return {
    id: row.id,
    userId: row.user_id,
    apiKeyId: row.api_key_id ?? null,
    actionName: row.action_name,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    status: row.status,
    result: parseJson<Record<string, unknown> | null>(row.result_json, null),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findAgentActionAuditByIdempotencyKey(
  env: AppEnv,
  userId: string,
  idempotencyKey: string,
) {
  const row = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND idempotency_key = ?
      LIMIT 1
    `,
    userId,
    idempotencyKey,
  );

  return row ? toAgentActionAuditRecord(row) : null;
}

export async function listRecentAgentActionAudits(
  env: AppEnv,
  userId: string,
  options: {
    actionName?: string | null;
    status?: AgentActionAuditStatus | null;
    resourceType?: string | null;
    limit?: number;
    offset?: number;
  } = {},
) {
  const actionName = options.actionName ?? null;
  const status = options.status ?? null;
  const resourceType = options.resourceType ?? null;
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const rows = await many<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE user_id = ?
        AND (? IS NULL OR action_name = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR resource_type = ?)
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `,
    userId,
    actionName,
    actionName,
    status,
    status,
    resourceType,
    resourceType,
    limit,
    offset,
  );

  return rows.map(toAgentActionAuditRecord);
}

export async function createAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    status?: AgentActionAuditStatus;
    result?: JsonRecord | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    input.status ?? "started",
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", id);
  return row ? toAgentActionAuditRecord(row) : null;
}

export async function claimAgentActionAudit(
  env: AppEnv,
  input: {
    userId: string;
    apiKeyId?: string | null;
    actionName: string;
    resourceType?: string | null;
    resourceId?: string | null;
    idempotencyKey?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'started', NULL, NULL, NULL, ?, ?, ?)
    `,
    id,
    input.userId,
    input.apiKeyId ?? null,
    input.actionName,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.idempotencyKey ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  const claimed = await one<AgentActionAuditRow>(
    env,
    "SELECT * FROM agent_action_audit WHERE id = ?",
    id,
  );
  if (claimed) {
    return {
      audit: toAgentActionAuditRecord(claimed),
      claimed: true,
    };
  }

  const existing = input.idempotencyKey
    ? await findAgentActionAuditByIdempotencyKey(env, input.userId, input.idempotencyKey)
    : null;
  return existing
    ? { audit: existing, claimed: false }
    : null;
}

export async function finishAgentActionAudit(
  env: AppEnv,
  auditId: string,
  input: {
    status: Exclude<AgentActionAuditStatus, "started">;
    resourceType?: string | null;
    resourceId?: string | null;
    result?: JsonRecord | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE agent_action_audit
      SET status = ?,
          resource_type = COALESCE(?, resource_type),
          resource_id = COALESCE(?, resource_id),
          result_json = ?,
          error_code = ?,
          error_message = ?,
          metadata_json = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.status,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.result ? jsonValue(input.result) : null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? {}),
    timestamp,
    auditId,
  );

  const row = await one<AgentActionAuditRow>(env, "SELECT * FROM agent_action_audit WHERE id = ?", auditId);
  return row ? toAgentActionAuditRecord(row) : null;
}

export async function closeCounterMoveFollowUp(
  env: AppEnv,
  input: {
    auditId: string;
    userId: string;
    eventId: string;
  },
) {
  const audit = await one<AgentActionAuditRow>(
    env,
    `
      SELECT *
      FROM agent_action_audit
      WHERE id = ?
        AND user_id = ?
        AND action_name = 'counter_move_brief.create'
        AND status = 'succeeded'
    `,
    input.auditId,
    input.userId,
  );
  if (!audit) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const result = parseJson<Record<string, unknown>>(audit.result_json, {});
  const brief =
    result.brief && typeof result.brief === "object" && !Array.isArray(result.brief)
      ? (result.brief as Record<string, unknown>)
      : {};
  const workflow =
    brief.workflow && typeof brief.workflow === "object" && !Array.isArray(brief.workflow)
      ? (brief.workflow as Record<string, unknown>)
      : {};
  const followUps = Array.isArray(workflow.followUps) ? workflow.followUps : [];
  let matched = false;
  const nextFollowUps = followUps.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const followUp = entry as Record<string, unknown>;
    if (followUp.eventId !== input.eventId || followUp.status === "closed") {
      return followUp;
    }
    matched = true;
    return {
      ...followUp,
      status: "closed",
    };
  });

  if (!matched) {
    return { ok: false as const, reason: "follow_up_not_found" as const };
  }

  const openCount = nextFollowUps.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).status !== "closed",
  ).length;

  const nextWorkflow = {
    ...workflow,
    followUps: nextFollowUps,
    openCount,
    status: openCount > 0 ? workflow.status ?? "needs_review" : "quiet",
  };
  const nextBrief = {
    ...brief,
    workflow: nextWorkflow,
  };
  const nextResult = {
    ...result,
    brief: nextBrief,
  };

  const updated = await finishAgentActionAudit(env, audit.id, {
    status: "succeeded",
    result: nextResult,
  });

  return updated ? { ok: true as const, audit: updated } : { ok: false as const, reason: "update_failed" as const };
}
