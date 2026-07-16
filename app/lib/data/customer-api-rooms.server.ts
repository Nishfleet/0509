/**
 * Customer API client-room persistence (D1).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` only
 * (no `~/lib/data.server` cycle).
 */

import {
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
import type {
  ClientRoomRecord,
  ClientRoomResourceRef,
} from "~/lib/types";

interface ClientRoomRow {
  id: string;
  user_id: string;
  name: string;
  client_label: string | null;
  status: ClientRoomRecord["status"];
  notes_json: string;
  created_at: string;
  updated_at: string;
}

interface ClientRoomResourceRow {
  id: string;
  room_id: string;
  user_id: string;
  resource_type: ClientRoomResourceRef["resourceType"];
  resource_id: string;
  label: string | null;
  created_at: string;
}

export interface AtomicClientRoomResourceInput {
  resourceType: ClientRoomResourceRef["resourceType"];
  resourceId: string;
  label?: string;
  ownerResourceType: "collection" | "watchlist" | "digest";
  ownerResourceId: string;
}

export interface AtomicClientRoomUpsertInput {
  auditId: string;
  /** The actor owns the audit record; userId remains the workspace owner. */
  auditUserId?: string;
  userId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  roomId: string;
  name: string;
  clientLabel: string | null;
  status: ClientRoomRecord["status"];
  notesJson: string;
  hasNotes: boolean;
  createdAt: string;
  updatedAt: string;
  /** Last observed room timestamp. Updates with a stale value must abort. */
  expectedUpdatedAt?: string | null;
  /** Agent writes cannot carry owner approvals; ref replacements clear them. */
  invalidateApprovals?: boolean;
  isUpdate: boolean;
  resourceRefs: AtomicClientRoomResourceInput[] | null;
}

export class ClientRoomWriteConflictError extends Error {
  readonly status = 409;
  readonly code = "stale_write";

  constructor(message = "This client room changed in another tab. Reload the client rooms page and try again.") {
    super(message);
    this.name = "ClientRoomWriteConflictError";
  }
}

export function prepareAtomicClientRoomUpsert(
  db: D1Database,
  input: AtomicClientRoomUpsertInput,
) {
  const auditUserId = input.auditUserId ?? input.userId;
  const auditPredicate = `
    EXISTS (
      SELECT 1
      FROM agent_action_audit
      WHERE id = ?
          AND user_id = ?
        AND action_name = 'client_room.upsert'
        AND idempotency_key = ?
        AND status = 'started'
        AND json_extract(metadata_json, '$.requestFingerprint') = ?
    )
  `;
  const roomStatement = input.isUpdate
    ? db.prepare(`
        UPDATE client_room
        SET name = ?,
            client_label = ?,
            status = ?,
            notes_json = CASE
              WHEN ? = 1 AND ? = 1 THEN json_remove(?, '$.reportApprovals')
              WHEN ? = 1 THEN ?
              WHEN ? = 1 THEN json_remove(notes_json, '$.reportApprovals')
              ELSE notes_json
            END,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND (? IS NULL OR updated_at = ?)
          AND NOT EXISTS (
            SELECT 1
            FROM client_room AS conflicting_room
            WHERE conflicting_room.user_id = ?
              AND conflicting_room.name = ?
              AND conflicting_room.id <> ?
          )
          AND ${auditPredicate}
      `).bind(
        input.name,
        input.clientLabel,
        input.status,
        input.hasNotes ? 1 : 0,
        input.invalidateApprovals ? 1 : 0,
        input.notesJson,
        input.hasNotes ? 1 : 0,
        input.notesJson,
        (input.invalidateApprovals ?? (input.resourceRefs !== null)) ? 1 : 0,
        input.updatedAt,
        input.roomId,
        input.userId,
        input.expectedUpdatedAt ?? null,
        input.expectedUpdatedAt ?? null,
        input.userId,
        input.name,
        input.roomId,
        input.auditId,
        auditUserId,
        input.idempotencyKey,
        input.requestFingerprint,
      )
    : db.prepare(`
        INSERT INTO client_room (
          id, user_id, name, client_label, status, notes_json, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM client_room
          WHERE user_id = ?
            AND name = ?
        )
          AND ${auditPredicate}
      `).bind(
        input.roomId,
        input.userId,
        input.name,
        input.clientLabel,
        input.status,
        input.notesJson,
        input.createdAt,
        input.updatedAt,
        input.userId,
        input.name,
        input.auditId,
        auditUserId,
        input.idempotencyKey,
        input.requestFingerprint,
      );

  const statements: D1PreparedStatement[] = [roomStatement];
  const effectExpectations: Array<"one" | "delete"> = ["one"];
  if (input.resourceRefs) {
    statements.push(
      db.prepare(`
        DELETE FROM client_room_resource
        WHERE room_id = ?
          AND user_id = ?
          AND ${auditPredicate}
      `).bind(
        input.roomId,
        input.userId,
        input.auditId,
        auditUserId,
        input.idempotencyKey,
        input.requestFingerprint,
      ),
    );
    effectExpectations.push("delete");

    for (const ref of input.resourceRefs) {
      const ownerTable =
        ref.ownerResourceType === "collection"
          ? "collection"
          : ref.ownerResourceType === "watchlist"
            ? "watchlist"
            : "digest_run";
      statements.push(
        db.prepare(`
          INSERT INTO client_room_resource (
            id, room_id, user_id, resource_type, resource_id, label, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE ${auditPredicate}
            AND EXISTS (
              SELECT 1
              FROM client_room
              WHERE id = ?
                AND user_id = ?
            )
            AND EXISTS (
              SELECT 1
              FROM ${ownerTable}
              WHERE id = ?
                AND user_id = ?
            )
        `).bind(
          createId(),
          input.roomId,
          input.userId,
          ref.resourceType,
          ref.resourceId,
          ref.label?.trim() || null,
          input.updatedAt,
          input.auditId,
          auditUserId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.roomId,
          input.userId,
          ref.ownerResourceId,
          input.userId,
        ),
      );
      effectExpectations.push("one");
    }
  }

  return { statements, effectExpectations };
}

function toClientRoomRecord(row: ClientRoomRow, resourceRefs: ClientRoomResourceRef[] = []): ClientRoomRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    clientLabel: row.client_label ?? null,
    status: row.status,
    resourceRefs,
    notes: parseJson<Record<string, unknown>>(row.notes_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sameClientRoomResourceRefs(left: ClientRoomResourceRef[], right: ClientRoomResourceRef[]) {
  if (left.length !== right.length) return false;
  const normalizedLeft = canonicalClientRoomResourceRefs(left);
  const normalizedRight = canonicalClientRoomResourceRefs(right);
  return normalizedLeft.every((ref, index) => {
    const other = normalizedRight[index];
    return Boolean(other) &&
      ref.resourceType === other.resourceType &&
      ref.resourceId === other.resourceId &&
      ref.label === other.label;
  });
}

function canonicalClientRoomResourceRefs(refs: ClientRoomResourceRef[]) {
  return refs
    .map((ref) => ({
      resourceType: ref.resourceType,
      resourceId: ref.resourceId,
      label: ref.label?.trim() || null,
    }))
    .sort((left, right) => {
      const leftKey = JSON.stringify([left.resourceType, left.resourceId, left.label]);
      const rightKey = JSON.stringify([right.resourceType, right.resourceId, right.label]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function clearReportApprovals(notes: JsonRecord) {
  const next = { ...notes };
  delete next.reportApprovals;
  return next;
}

export function preserveClientRoomReportApprovals(nextNotes: JsonRecord, existingNotes: JsonRecord) {
  if (
    Object.prototype.hasOwnProperty.call(nextNotes, "reportApprovals") ||
    !Object.prototype.hasOwnProperty.call(existingNotes, "reportApprovals")
  ) {
    return nextNotes;
  }
  return {
    ...nextNotes,
    reportApprovals: existingNotes.reportApprovals,
  };
}

function requireOneChange(db: D1Database) {
  return db.prepare(
    `SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('{', '$') END AS room_write_committed`,
  ).bind();
}

export function strictlyNewerClientRoomTimestamp(previous: string | undefined, candidate: string) {
  if (!previous) return candidate;
  const previousMs = Date.parse(previous);
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(previousMs) || !Number.isFinite(candidateMs) || candidateMs > previousMs) {
    return candidate;
  }
  return new Date(previousMs + 1).toISOString();
}

async function listClientRoomResourceRefs(env: AppEnv, userId: string, roomId: string) {
  const rows = await many<ClientRoomResourceRow>(
    env,
    `
      SELECT *
      FROM client_room_resource
      WHERE room_id = ?
        AND user_id = ?
      ORDER BY created_at ASC
    `,
    roomId,
    userId,
  );

  return rows.map((row) => ({
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ...(row.label ? { label: row.label } : {}),
  }));
}

export async function getClientRoom(env: AppEnv, userId: string, roomId: string) {
  const row = await one<ClientRoomRow>(
    env,
    `
      SELECT *
      FROM client_room
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
    `,
    roomId,
    userId,
  );

  return row ? toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id)) : null;
}

export async function getClientRoomByName(env: AppEnv, userId: string, name: string) {
  const row = await one<ClientRoomRow>(
    env,
    `
      SELECT *
      FROM client_room
      WHERE user_id = ?
        AND name = ?
      LIMIT 1
    `,
    userId,
    name.trim(),
  );

  return row ? toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id)) : null;
}

export async function upsertClientRoom(
  env: AppEnv,
  userId: string,
  input: {
    roomId?: string | null;
    name: string;
    clientLabel?: string | null;
    status?: ClientRoomRecord["status"] | null;
    resourceRefs?: ClientRoomResourceRef[] | null;
    notes?: JsonRecord | null;
    expectedUpdatedAt?: string | null;
  },
) {
  const db = ensureDb(env);
  let timestamp = nowIso();
  const name = input.name.trim();
  const status = input.status ?? "active";
  const clientLabel = input.clientLabel?.trim() || null;
  const hasResourceRefs = Array.isArray(input.resourceRefs);
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");
  const notesJson = hasNotes ? jsonValue(input.notes ?? {}) : null;

  const existing = input.roomId
    ? await getClientRoom(env, userId, input.roomId)
    : await getClientRoomByName(env, userId, name);

  if (input.roomId && !existing) {
    return null;
  }

  if (existing) {
    timestamp = strictlyNewerClientRoomTimestamp(existing.updatedAt, timestamp);
    const expectedUpdatedAt = input.expectedUpdatedAt ?? null;
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      throw new ClientRoomWriteConflictError();
    }

    const conflictingRoom = await one<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
          AND name = ?
          AND id <> ?
        LIMIT 1
      `,
      userId,
      name,
      existing.id,
    );
    if (conflictingRoom) {
      return null;
    }

    const nextRefs = input.resourceRefs ?? existing.resourceRefs;
    const refsChanged = hasResourceRefs && !sameClientRoomResourceRefs(existing.resourceRefs, nextRefs);
    const suppliedNotes = hasNotes
      ? preserveClientRoomReportApprovals(input.notes ?? {}, existing.notes)
      : existing.notes;
    const nextNotes = refsChanged
      ? clearReportApprovals(suppliedNotes)
      : suppliedNotes;
    const statements: D1PreparedStatement[] = [
      db.prepare(`
        UPDATE client_room
        SET name = ?,
            client_label = ?,
            status = ?,
            notes_json = ?,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND (? IS NULL OR updated_at = ?)
      `).bind(
        name,
        clientLabel,
        status,
        jsonValue(nextNotes),
        timestamp,
        existing.id,
        userId,
        input.expectedUpdatedAt ?? null,
        input.expectedUpdatedAt ?? null,
      ),
      requireOneChange(db),
    ];
    if (hasResourceRefs) {
      statements.push(
        db.prepare(`DELETE FROM client_room_resource WHERE room_id = ? AND user_id = ?`).bind(existing.id, userId),
      );
      for (const ref of input.resourceRefs ?? []) {
        statements.push(
          db.prepare(`
            INSERT INTO client_room_resource
              (id, room_id, user_id, resource_type, resource_id, label, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            createId(), existing.id, userId, ref.resourceType, ref.resourceId,
            ref.label?.trim() || null, timestamp,
          ),
        );
      }
    }
    try {
      if (typeof db.batch !== "function") {
        throw new Error("D1 batch transactions are required for client room writes.");
      }
      await db.batch(statements);
    } catch (error) {
      if (input.expectedUpdatedAt) {
        const current = await getClientRoom(env, userId, existing.id);
        if (!current || current.updatedAt !== input.expectedUpdatedAt) {
          throw new ClientRoomWriteConflictError();
        }
      }
      throw error;
    }
    return getClientRoom(env, userId, existing.id);
  }

  const id = createId();
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO client_room
        (id, user_id, name, client_label, status, notes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, userId, name, clientLabel, status, notesJson ?? jsonValue({}), timestamp, timestamp,
    ),
    requireOneChange(db),
  ];
  if (hasResourceRefs) {
    statements.push(
      db.prepare(`
        DELETE FROM client_room_resource
        WHERE room_id = (
          SELECT id
          FROM client_room
          WHERE user_id = ?
            AND name = ?
        )
          AND user_id = ?
      `).bind(userId, name, userId),
    );
    for (const ref of input.resourceRefs ?? []) {
      statements.push(
        db.prepare(`
          INSERT INTO client_room_resource (id, room_id, user_id, resource_type, resource_id, label, created_at)
          SELECT ?, room.id, ?, ?, ?, ?, ?
          FROM client_room AS room
          WHERE room.user_id = ?
            AND room.name = ?
        `).bind(
          createId(), userId, ref.resourceType, ref.resourceId,
          ref.label?.trim() || null, timestamp, userId, name,
        ),
      );
    }
  }
  if (typeof db.batch !== "function") {
    throw new Error("D1 batch transactions are required for client room writes.");
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const conflicted = await getClientRoomByName(env, userId, name);
    if (!conflicted) throw error;
    return upsertClientRoom(env, userId, {
      ...input,
      roomId: conflicted.id,
      expectedUpdatedAt: conflicted.updatedAt,
    });
  }
  const persisted = await one<Pick<ClientRoomRow, "id">>(
    env,
    `SELECT id FROM client_room WHERE user_id = ? AND name = ? LIMIT 1`,
    userId,
    name,
  );
  return persisted ? getClientRoom(env, userId, persisted.id) : null;
}

export async function listClientRooms(
  env: AppEnv,
  userId: string,
  options: {
    status?: ClientRoomRecord["status"] | "all" | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const status = options.status ?? "active";
  const rows = status === "all"
    ? await many<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      limit,
    )
    : await many<ClientRoomRow>(
      env,
      `
        SELECT *
        FROM client_room
        WHERE user_id = ?
          AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      userId,
      status,
      limit,
    );

  return Promise.all(
    rows.map(async (row) => toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id))),
  );
}
