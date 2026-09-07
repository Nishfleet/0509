/**
 * Customer API agent-memory persistence (D1).
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports `d1.server` + `helpers.server` only
 * (no `~/lib/data.server` cycle).
 */

import {
  execute as run,
  queryAll as many,
  queryIn,
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
  AgentMemoryRecord,
  AgentMemoryScope,
} from "~/lib/types";

interface AgentMemoryRow {
  id: string;
  user_id: string;
  scope: AgentMemoryScope;
  memory_key: string;
  watchlist_id: string | null;
  client_room_id: string | null;
  value_json: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function toAgentMemoryRecord(row: AgentMemoryRow): AgentMemoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope,
    key: row.memory_key,
    watchlistId: row.watchlist_id ?? null,
    clientRoomId: row.client_room_id ?? null,
    value: parseJson<Record<string, unknown>>(row.value_json, {}),
    source: row.source ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findAgentMemoryRow(
  env: AppEnv,
  userId: string,
  input: {
    scope: AgentMemoryScope;
    key: string;
    watchlistId: string | null;
    clientRoomId: string | null;
  },
) {
  return one<AgentMemoryRow>(
    env,
    `
      SELECT *
      FROM agent_memory
      WHERE user_id = ?
        AND scope = ?
        AND memory_key = ?
        AND watchlist_id IS ?
        AND client_room_id IS ?
      LIMIT 1
    `,
    userId,
    input.scope,
    input.key,
    input.watchlistId,
    input.clientRoomId,
  );
}

export async function upsertAgentMemory(
  env: AppEnv,
  userId: string,
  input: {
    scope: AgentMemoryScope;
    key: string;
    watchlistId?: string | null;
    clientRoomId?: string | null;
    value: JsonRecord;
    source?: string | null;
  },
) {
  const id = createId();
  const timestamp = nowIso();
  const key = input.key.trim();
  const watchlistId = input.watchlistId?.trim() || null;
  const clientRoomId = input.clientRoomId?.trim() || null;
  if (watchlistId && clientRoomId) {
    throw new Error("Agent memory can be scoped to either a watchlist or a client room, not both.");
  }

  const existing = await findAgentMemoryRow(env, userId, {
    scope: input.scope,
    key,
    watchlistId,
    clientRoomId,
  });

  if (existing) {
    await run(
      env,
      `
        UPDATE agent_memory
        SET value_json = ?,
            source = ?,
            updated_at = ?
        WHERE id = ?
      `,
      jsonValue(input.value),
      input.source ?? null,
      timestamp,
      existing.id,
    );

    const row = await one<AgentMemoryRow>(env, "SELECT * FROM agent_memory WHERE id = ?", existing.id);
    return row ? toAgentMemoryRecord(row) : null;
  }

  await run(
    env,
    `
      INSERT OR IGNORE INTO agent_memory (
        id,
        user_id,
        scope,
        memory_key,
        watchlist_id,
        client_room_id,
        value_json,
        source,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    input.scope,
    key,
    watchlistId,
    clientRoomId,
    jsonValue(input.value),
    input.source ?? null,
    timestamp,
    timestamp,
  );

  const row = await findAgentMemoryRow(env, userId, {
    scope: input.scope,
    key,
    watchlistId,
    clientRoomId,
  });

  if (row && row.id !== id) {
    await run(
      env,
      `
        UPDATE agent_memory
        SET value_json = ?,
            source = ?,
            updated_at = ?
        WHERE id = ?
      `,
      jsonValue(input.value),
      input.source ?? null,
      timestamp,
      row.id,
    );
    const updated = await one<AgentMemoryRow>(env, "SELECT * FROM agent_memory WHERE id = ?", row.id);
    return updated ? toAgentMemoryRecord(updated) : null;
  }

  return row ? toAgentMemoryRecord(row) : null;
}

export async function listAgentMemory(
  env: AppEnv,
  userId: string,
  options: {
    scope?: AgentMemoryScope | null;
    watchlistId?: string | null;
    clientRoomId?: string | null;
    limit?: number | null;
  } = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const clauses = ["user_id = ?"];
  const bindings: unknown[] = [userId];

  if (options.scope) {
    clauses.push("scope = ?");
    bindings.push(options.scope);
  }
  if (typeof options.watchlistId !== "undefined") {
    clauses.push(options.watchlistId ? "watchlist_id = ?" : "watchlist_id IS NULL");
    if (options.watchlistId) {
      bindings.push(options.watchlistId);
    }
  }
  if (typeof options.clientRoomId !== "undefined") {
    clauses.push(options.clientRoomId ? "client_room_id = ?" : "client_room_id IS NULL");
    if (options.clientRoomId) {
      bindings.push(options.clientRoomId);
    }
  }

  const rows = await many<AgentMemoryRow>(
    env,
    `
      SELECT *
      FROM agent_memory
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    ...bindings,
    limit,
  );

  return rows.map(toAgentMemoryRecord);
}

export async function listAgentMemoryForClientRooms(
  env: AppEnv,
  userId: string,
  roomIds: string[],
  options: {
    limitPerRoom?: number | null;
  } = {},
) {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
  if (uniqueRoomIds.length === 0) {
    return [];
  }

  const limitPerRoom = Math.max(1, Math.min(100, Math.floor(options.limitPerRoom ?? 20)));
  const rows = await queryIn<AgentMemoryRow>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM (
        SELECT
          agent_memory.*,
          ROW_NUMBER() OVER (
            PARTITION BY client_room_id
            ORDER BY updated_at DESC
          ) AS room_rank
        FROM agent_memory
        WHERE user_id = ?
          AND watchlist_id IS NULL
          AND client_room_id IN (${placeholders})
      )
      WHERE room_rank <= ?
      ORDER BY updated_at DESC
    `,
    values: uniqueRoomIds,
    prefix: [userId],
    suffix: [limitPerRoom],
    chunkSize: 80,
  });

  return rows.map(toAgentMemoryRecord);
}
