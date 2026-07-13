/**
 * Customer API client-room persistence (D1).
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

async function replaceClientRoomResourceRefs(
  env: AppEnv,
  userId: string,
  roomId: string,
  refs: ClientRoomResourceRef[],
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      DELETE FROM client_room_resource
      WHERE room_id = ?
        AND user_id = ?
    `,
    roomId,
    userId,
  );

  for (const ref of refs) {
    await run(
      env,
      `
        INSERT INTO client_room_resource (
          id,
          room_id,
          user_id,
          resource_type,
          resource_id,
          label,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      createId(),
      roomId,
      userId,
      ref.resourceType,
      ref.resourceId,
      ref.label?.trim() || null,
      timestamp,
    );
  }
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
  },
) {
  const timestamp = nowIso();
  const name = input.name.trim();
  const status = input.status ?? "active";
  const clientLabel = input.clientLabel?.trim() || null;
  const hasResourceRefs = Array.isArray(input.resourceRefs);
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");
  const notesJson = hasNotes ? jsonValue(input.notes ?? {}) : null;

  if (input.roomId) {
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
      input.roomId,
    );
    if (conflictingRoom) {
      return null;
    }

    await run(
      env,
      `
        UPDATE client_room
        SET name = ?,
            client_label = ?,
            status = ?,
            notes_json = CASE WHEN ? = 1 THEN ? ELSE notes_json END,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
      `,
      name,
      clientLabel,
      status,
      hasNotes ? 1 : 0,
      notesJson,
      timestamp,
      input.roomId,
      userId,
    );

    const updatedRoom = await getClientRoom(env, userId, input.roomId);
    if (!updatedRoom) {
      return null;
    }

    if (hasResourceRefs) {
      await replaceClientRoomResourceRefs(env, userId, input.roomId, input.resourceRefs ?? []);
      return getClientRoom(env, userId, input.roomId);
    }

    return updatedRoom;
  }

  const id = createId();
  await run(
    env,
    `
      INSERT INTO client_room (
        id,
        user_id,
        name,
        client_label,
        status,
        notes_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, name)
      DO UPDATE SET client_label = excluded.client_label,
                    status = excluded.status,
                    notes_json = CASE WHEN ? = 1 THEN excluded.notes_json ELSE client_room.notes_json END,
                    updated_at = excluded.updated_at
    `,
    id,
    userId,
    name,
    clientLabel,
    status,
    notesJson ?? jsonValue({}),
    timestamp,
    timestamp,
    hasNotes ? 1 : 0,
  );

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
    name,
  );

  if (row && hasResourceRefs) {
    await replaceClientRoomResourceRefs(env, userId, row.id, input.resourceRefs ?? []);
  }

  return row ? toClientRoomRecord(row, await listClientRoomResourceRefs(env, userId, row.id)) : null;
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
