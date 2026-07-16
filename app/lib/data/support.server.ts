/**
 * Support-case D1 persistence (create / list / get / events / reopen).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` directly
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  ensureDb,
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
import { normalizeSupportCaseInput, SupportCaseInputError } from "~/lib/support";
import { SUPPORT_CASE_EVENT_TYPES } from "~/lib/types";
import type {
  SupportCaseCategory,
  SupportCaseEventRecord,
  SupportCaseEventType,
  SupportCasePriority,
  SupportCaseRecord,
  SupportCaseStatus,
} from "~/lib/types";

interface SupportCaseRow {
  id: string;
  user_id: string;
  request_key: string | null;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  subject: string;
  detail: string;
  context_json: string;
  created_at: string;
  updated_at: string;
}

interface SupportCaseEventRow {
  id: string;
  case_id: string;
  user_id: string;
  event_type: SupportCaseEventType;
  message: string;
  visible_to_customer: number;
  metadata_json: string;
  created_at: string;
}

function toSupportCaseRecord(row: SupportCaseRow): SupportCaseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    requestKey: row.request_key ?? null,
    category: row.category,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    detail: row.detail,
    context: parseJson<Record<string, unknown>>(row.context_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSupportCaseEventRecord(row: SupportCaseEventRow): SupportCaseEventRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    userId: row.user_id,
    eventType: row.event_type,
    message: row.message,
    visibleToCustomer: row.visible_to_customer === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function normalizeOptionalIdempotencyKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 120 ? trimmed : null;
}

export async function createSupportCase(
  env: AppEnv,
  input: {
    userId: string;
    category: unknown;
    subject: unknown;
    detail: unknown;
    priority?: unknown;
    context?: JsonRecord | null;
    requestKey?: string | null;
    reopenClosed?: boolean;
  },
) {
  const normalized = normalizeSupportCaseInput({
    category: input.category,
    priority: input.priority ?? "normal",
    subject: input.subject,
    detail: input.detail,
  });
  const id = createId();
  const timestamp = nowIso();
  const requestKey = normalizeOptionalIdempotencyKey(input.requestKey);

  if (requestKey) {
    const existing = await one<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND request_key = ?
        LIMIT 1
      `,
      input.userId,
      requestKey,
    );
    if (existing) {
      if (existing.status === "closed" && input.reopenClosed) {
        const reopened = await reopenSupportCaseForRequest(env, {
          caseId: existing.id,
          userId: input.userId,
          category: normalized.category,
          priority: normalized.priority,
          subject: normalized.subject,
          detail: normalized.detail,
          context: input.context ?? {},
          timestamp,
        });
        if (reopened) {
          return {
            ...reopened.record,
            alreadyExists: !reopened.didReopen,
            ...(reopened.didReopen ? { reopened: true } : {}),
          };
        }
      }

      return {
        ...toSupportCaseRecord(existing),
        alreadyExists: true,
      };
    }
  }

  const eventId = createId();
  const eventMessage = supportCaseOpenedEventMessage(input.context ?? {});
  const eventMetadata = jsonValue({
    category: normalized.category,
    priority: normalized.priority,
    ...supportCaseOpenedEventMetadata(input.context ?? {}),
  });
  const db = ensureDb(env);
  const caseInsert = db.prepare(`
      INSERT OR IGNORE INTO support_case (
        id,
        user_id,
        request_key,
        category,
        priority,
        status,
        subject,
        detail,
        context_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).bind(
    id,
    input.userId,
    requestKey,
    normalized.category,
    normalized.priority,
    normalized.subject,
    normalized.detail,
    jsonValue(input.context ?? {}),
    timestamp,
    timestamp,
  );
  const eventInsert = requestKey
    ? db.prepare(`
        INSERT INTO support_case_event (
          id,
          case_id,
          user_id,
          event_type,
          message,
          visible_to_customer,
          metadata_json,
          created_at
        )
        SELECT ?, ?, ?, 'case_opened', ?, 1, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM support_case
          WHERE id = ?
            AND user_id = ?
            AND request_key = ?
        )
      `).bind(
        eventId,
        id,
        input.userId,
        eventMessage,
        eventMetadata,
        timestamp,
        id,
        input.userId,
        requestKey,
      )
    : db.prepare(`
        INSERT INTO support_case_event (
          id,
          case_id,
          user_id,
          event_type,
          message,
          visible_to_customer,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, 'case_opened', ?, 1, ?, ?)
      `).bind(
        eventId,
        id,
        input.userId,
        eventMessage,
        eventMetadata,
        timestamp,
      );

  await db.batch([caseInsert, eventInsert]);

  if (requestKey) {
    const row = await one<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND request_key = ?
        LIMIT 1
      `,
      input.userId,
      requestKey,
    );

    if (!row) {
      return null;
    }

    const createdNewCase = row.id === id;

    return {
      ...toSupportCaseRecord(row),
      alreadyExists: !createdNewCase,
    };
  }

  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    id,
    input.userId,
  );

  if (!row) {
    return null;
  }

  return {
    ...toSupportCaseRecord(row),
    alreadyExists: false,
  };
}

export async function listSupportCases(
  env: AppEnv,
  userId: string,
  options: {
    status?: SupportCaseStatus | "all" | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  const status = options.status ?? "all";
  const rows = status === "all"
    ? await many<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      limit,
    )
    : await many<SupportCaseRow>(
      env,
      `
        SELECT *
        FROM support_case
        WHERE user_id = ?
          AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      status,
      limit,
    );

  return rows.map(toSupportCaseRecord);
}

export async function getSupportCase(env: AppEnv, userId: string, caseId: string) {
  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    caseId,
    userId,
  );

  return row ? toSupportCaseRecord(row) : null;
}

export async function createSupportCaseEvent(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    eventType: unknown;
    message: unknown;
    visibleToCustomer?: boolean;
    metadata?: JsonRecord | null;
    idempotencyKey?: string | null;
  },
) {
  const eventType = readSupportCaseEventType(input.eventType);
  if (!eventType) {
    throw new SupportCaseInputError("invalid_support_case_event", "Choose a valid support case event.");
  }

  const message = normalizeSupportCaseEventMessage(input.message);
  const idempotencyKey = typeof input.idempotencyKey === "string"
    ? input.idempotencyKey.trim()
    : null;
  if (idempotencyKey !== null && (idempotencyKey.length === 0 || idempotencyKey.length > 160)) {
    throw new SupportCaseInputError(
      "invalid_support_case_event_idempotency_key",
      "Choose a valid support case event key.",
    );
  }
  const id = createId();
  const timestamp = nowIso();
  const metadata = jsonValue({
    ...(input.metadata ?? {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  await run(
    env,
    idempotencyKey
      ? `
      INSERT INTO support_case_event (
        id,
        case_id,
        user_id,
        event_type,
        message,
        visible_to_customer,
        metadata_json,
        created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM support_case_event
        WHERE case_id = ?
          AND user_id = ?
          AND event_type = ?
          AND json_extract(metadata_json, '$.idempotencyKey') = ?
      )
    `
      : `
      INSERT INTO support_case_event (
        id,
        case_id,
        user_id,
        event_type,
        message,
        visible_to_customer,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.caseId,
    input.userId,
    eventType,
    message,
    input.visibleToCustomer === false ? 0 : 1,
    metadata,
    timestamp,
    ...(idempotencyKey ? [input.caseId, input.userId, eventType, idempotencyKey] : []),
  );

  const row = await one<SupportCaseEventRow>(
    env,
    idempotencyKey
      ? `
      SELECT *
      FROM support_case_event
      WHERE case_id = ?
        AND user_id = ?
        AND event_type = ?
        AND json_extract(metadata_json, '$.idempotencyKey') = ?
      ORDER BY created_at ASC
      LIMIT 1
    `
      : `
      SELECT *
      FROM support_case_event
      WHERE id = ?
      LIMIT 1
    `,
    ...(idempotencyKey ? [input.caseId, input.userId, eventType, idempotencyKey] : [id]),
  );

  return row ? toSupportCaseEventRecord(row) : null;
}

export async function listSupportCaseEvents(
  env: AppEnv,
  userId: string,
  caseId: string,
  options: {
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 30)));
  const rows = await many<SupportCaseEventRow>(
    env,
    `
      SELECT *
      FROM (
        SELECT *
        FROM support_case_event
        WHERE case_id = ?
          AND user_id = ?
          AND visible_to_customer = 1
        ORDER BY created_at DESC
        LIMIT ?
      )
      ORDER BY created_at ASC
    `,
    caseId,
    userId,
    limit,
  );

  return rows.map(toSupportCaseEventRecord);
}

function readSupportCaseEventType(value: unknown): SupportCaseEventType | null {
  return SUPPORT_CASE_EVENT_TYPES.includes(value as SupportCaseEventType)
    ? (value as SupportCaseEventType)
    : null;
}

function normalizeSupportCaseEventMessage(value: unknown) {
  if (typeof value !== "string") {
    throw new SupportCaseInputError("invalid_support_case_event_message", "Add a support case event message.");
  }

  const message = value.trim();
  if (!message || message.length > 1000) {
    throw new SupportCaseInputError(
      "invalid_support_case_event_message",
      "Keep support case event messages between 1 and 1,000 characters.",
    );
  }

  return message;
}

async function reopenSupportCaseForRequest(
  env: AppEnv,
  input: {
    caseId: string;
    userId: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    subject: string;
    detail: string;
    context: JsonRecord;
    timestamp: string;
  },
) {
  const eventId = createId();
  const eventMetadata = jsonValue({
    category: input.category,
    priority: input.priority,
    fromStatus: "closed",
    toStatus: "open",
    transitionAt: input.timestamp,
    ...supportCaseOpenedEventMetadata(input.context),
  });
  const db = ensureDb(env);
  const results = await db.batch([
    db.prepare(`
      UPDATE support_case
      SET category = ?,
          priority = ?,
          status = 'open',
          subject = ?,
          detail = ?,
          context_json = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND status = 'closed'
    `).bind(
      input.category,
      input.priority,
      input.subject,
      input.detail,
      jsonValue(input.context),
      input.timestamp,
      input.caseId,
      input.userId,
    ),
    db.prepare(`
      INSERT INTO support_case_event (
        id,
        case_id,
        user_id,
        event_type,
        message,
        visible_to_customer,
        metadata_json,
        created_at
      )
      SELECT ?, ?, ?, 'status_changed', ?, 1, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM support_case
        WHERE id = ?
          AND user_id = ?
          AND status = 'open'
          AND updated_at = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM support_case_event
        WHERE case_id = ?
          AND event_type = 'status_changed'
          AND json_extract(metadata_json, '$.transitionAt') = ?
      )
    `).bind(
      eventId,
      input.caseId,
      input.userId,
      "Support case reopened from a new signed-in request.",
      eventMetadata,
      input.timestamp,
      input.caseId,
      input.userId,
      input.timestamp,
      input.caseId,
      input.timestamp,
    ),
  ]);

  const row = await one<SupportCaseRow>(
    env,
    `
      SELECT *
      FROM support_case
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    input.caseId,
    input.userId,
  );
  if (!row) {
    return null;
  }

  return {
    record: toSupportCaseRecord(row),
    didReopen: Number(results[0]?.meta?.changes ?? 0) === 1,
  };
}

function supportCaseOpenedEventMessage(context: JsonRecord) {
  const createdFrom = typeof context.createdFrom === "string" ? context.createdFrom : null;
  if (createdFrom === "signed_in_support") {
    return "Support case opened from the signed-in support form.";
  }
  if (createdFrom === "agent_action") {
    return "Support case opened by an account agent action.";
  }

  return "Support case opened.";
}

function supportCaseOpenedEventMetadata(context: JsonRecord): JsonRecord {
  const metadata: JsonRecord = {};
  if (typeof context.createdFrom === "string") {
    metadata.createdFrom = context.createdFrom;
  }
  if (typeof context.source === "string") {
    metadata.source = context.source;
  }
  return metadata;
}
