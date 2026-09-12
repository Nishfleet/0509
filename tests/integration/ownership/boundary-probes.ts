import {
  listWatchlists,
  getWatchlist,
  setWatchlistActive,
} from "~/lib/data/watchlists-core.server";
import {
  listCollections,
  getCollection,
  deleteCollection,
} from "~/lib/data/collections.server";
import {
  listActiveShareLinks,
  revokeShareLink,
} from "~/lib/data/shares.server";
import {
  listCustomerApiKeys,
  revokeCustomerApiKey,
} from "~/lib/data/customer-api-keys.server";
import {
  listClientRooms,
  getClientRoom,
  upsertClientRoom,
} from "~/lib/data/customer-api-rooms.server";
import {
  listAgentMemory,
  upsertAgentMemory,
} from "~/lib/data/customer-api-memory.server";
import {
  listSupportCases,
  getSupportCase,
} from "~/lib/data/support.server";
import {
  listSavedQueries,
  getSavedQuery,
} from "~/lib/data/workspace-user.server";
import {
  listTrackedEntities,
  getTrackedEntity,
  softDeleteTrackedEntity,
} from "~/lib/presence-data.server";
import {
  listSourceTargetsForEntity,
  getSourceTarget,
  updateSourceTargetCoverageLabel,
} from "~/lib/presence-data.server";

import { uid, ISO_T0 } from "../fixtures";
import type { OwnedTableProbe } from "./harness";

/**
 * Wave-1 boundary probes (epic #2993 P1). Every probe drives the REAL data
 * seam (`app/lib/data/*.server.ts` helpers that routes call) against real D1;
 * no SQL bypass and no mocked bindings. Tables waiting for probes live in
 * `ownership-manifest.ts` under OWNED_PROBE_PENDING with their phase issue.
 *
 * Probes that seed a row need unique ids/names/hashes per workspace — the
 * fixtures' `uid()` is unique per test file, and per-owner keys are namespaced
 * with the owner id where the schema allows duplicates across owners.
 */

async function insertRow(env: Parameters<OwnedTableProbe["seed"]>[0], sql: string, ...bind: unknown[]) {
  await env.DB?.prepare(sql)
    .bind(...bind)
    .run();
}

const watchlistProbe: OwnedTableProbe = {
  table: "watchlist",
  async seed(env, workspaceUserId) {
    const id = uid("wl");
    await insertRow(
      env,
      `INSERT INTO watchlist (
         id, user_id, name, target_type, target_id, target_fingerprint,
         target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary ${id}`,
      `target_${id}`,
      `fp_${id}`,
      `Label ${id}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listWatchlists(env, workspaceUserId)).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getWatchlist(env, rowId, workspaceUserId);
  },
  async mutate(env, workspaceUserId, rowId) {
    await setWatchlistActive(env, workspaceUserId, rowId, false);
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT is_active, paused_reason, updated_at FROM watchlist WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const collectionProbe: OwnedTableProbe = {
  table: "collection",
  async seed(env, workspaceUserId) {
    const id = uid("coll");
    await insertRow(
      env,
      `INSERT INTO collection (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary ${id}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listCollections(env, workspaceUserId)).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getCollection(env, rowId, workspaceUserId);
  },
  async mutate(env, workspaceUserId, rowId) {
    await deleteCollection(env, workspaceUserId, rowId);
  },
  async snapshot(env, rowId) {
    const row = await env.DB?.prepare(`SELECT id FROM collection WHERE id = ?`)
      .bind(rowId)
      .first<{ id: string }>();
    return row ? { exists: 1 } : { exists: 0 };
  },
};

const shareLinkProbe: OwnedTableProbe = {
  table: "share_link",
  async seed(env, workspaceUserId) {
    const id = uid("share");
    await insertRow(
      env,
      `INSERT INTO share_link (id, token, user_id, resource_type, resource_id, is_snapshot, created_at)
       VALUES (?, ?, ?, 'collection', ?, 0, ?)`,
      id,
      `tok_${id}_${crypto.randomUUID().slice(0, 8)}`,
      workspaceUserId,
      id,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listActiveShareLinks(env, workspaceUserId)).map((row) => row.id);
  },
  async mutate(env, workspaceUserId, rowId) {
    await revokeShareLink(env, workspaceUserId, rowId);
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT revoked_at FROM share_link WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const customerApiKeyProbe: OwnedTableProbe = {
  table: "customer_api_key",
  async seed(env, workspaceUserId) {
    const id = uid("cak");
    await insertRow(
      env,
      `INSERT INTO customer_api_key (id, user_id, name, key_prefix, key_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary ${id}`,
      `prefix_${id}`,
      `hash_${id}_${crypto.randomUUID().slice(0, 8)}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listCustomerApiKeys(env, workspaceUserId)).map((row) => row.id);
  },
  async mutate(env, workspaceUserId, rowId) {
    await revokeCustomerApiKey(env, { userId: workspaceUserId, apiKeyId: rowId });
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT revoked_at FROM customer_api_key WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const clientRoomProbe: OwnedTableProbe = {
  table: "client_room",
  async seed(env, workspaceUserId) {
    const id = uid("room");
    await insertRow(
      env,
      `INSERT INTO client_room (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      workspaceUserId,
      `boundary-${id}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listClientRooms(env, workspaceUserId, { status: "all" })).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getClientRoom(env, workspaceUserId, rowId);
  },
  async mutate(env, workspaceUserId, rowId, variant) {
    // The room id belongs to the foreign workspace in the crossAttempt
    // variant; the seam must refuse (getClientRoom guard) instead of editing.
    await upsertClientRoom(env, workspaceUserId, {
      roomId: rowId,
      name: variant === "ownApply" ? `renamed-${rowId}` : `renamed-by-foreign-${rowId}`,
    });
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT name, status FROM client_room WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const agentMemoryProbe: OwnedTableProbe = {
  table: "agent_memory",
  async seed(env, workspaceUserId) {
    const id = uid("mem");
    await insertRow(
      env,
      `INSERT INTO agent_memory (id, user_id, scope, memory_key, value_json, created_at, updated_at)
       VALUES (?, ?, 'workspace', ?, ?, ?, ?)`,
      id,
      workspaceUserId,
      `boundary-key-${workspaceUserId}-${id}`,
      JSON.stringify({ v: "seeded" }),
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listAgentMemory(env, workspaceUserId, { scope: "workspace" })).map(
      (row) => row.id,
    );
  },
  async mutate(env, workspaceUserId, rowId, variant) {
    // Same key as the foreign row in the crossAttempt variant: the seam must
    // write the actor's OWN row (key lookup is user-scoped), never the
    // foreign one.
    await upsertAgentMemory(env, workspaceUserId, {
      scope: "workspace",
      key: `boundary-key-${workspaceUserId}-${rowId}`,
      value: { v: variant === "ownApply" ? "applied" : "cross" },
    });
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT value_json FROM agent_memory WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const supportCaseProbe: OwnedTableProbe = {
  table: "support_case",
  async seed(env, workspaceUserId) {
    const id = uid("case");
    await insertRow(
      env,
      `INSERT INTO support_case (id, user_id, category, subject, detail, created_at, updated_at)
       VALUES (?, ?, 'other', ?, ?, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary case ${id}`,
      `Detail for ${id} so the length CHECK passes.`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listSupportCases(env, workspaceUserId)).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getSupportCase(env, workspaceUserId, rowId);
  },
  // No scoped id-mutation helper is route-reachable for support cases today
  // (createSupportCaseEvent lacks an owner guard — plan §6.3); its guard and
  // probe land with P3 (#3076).
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT status FROM support_case WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const savedQueryProbe: OwnedTableProbe = {
  table: "saved_query",
  async seed(env, workspaceUserId) {
    const id = uid("sq");
    await insertRow(
      env,
      `INSERT INTO saved_query (
         id, user_id, name, mode, query_text, normalized_query_json,
         fingerprint, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', ?, '{}', ?, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary ${id}`,
      `query ${id}`,
      `fp_${id}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listSavedQueries(env, workspaceUserId)).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getSavedQuery(env, rowId, workspaceUserId);
  },
  // touchSavedQueryRun() is not user-scoped yet (plan §6.4) — guard + probe
  // land with P3 (#3076).
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT run_count FROM saved_query WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

const trackedEntityProbe: OwnedTableProbe = {
  table: "tracked_entity",
  async seed(env, workspaceUserId) {
    const id = uid("ent");
    await insertRow(
      env,
      `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, created_at, updated_at)
       VALUES (?, ?, 'competitor', ?, ?, ?)`,
      id,
      workspaceUserId,
      `Boundary ${id}`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    return (await listTrackedEntities(env, workspaceUserId)).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getTrackedEntity(env, workspaceUserId, rowId);
  },
  async mutate(env, workspaceUserId, rowId) {
    await softDeleteTrackedEntity(env, workspaceUserId, rowId);
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT is_active, deleted_at FROM tracked_entity WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

/** source_target seeds its parent tracked_entity too; keep the mapping. */
const sourceTargetEntityByOwner = new Map<string, string>();

const sourceTargetProbe: OwnedTableProbe = {
  table: "source_target",
  async seed(env, workspaceUserId) {
    let entityId = sourceTargetEntityByOwner.get(workspaceUserId);
    if (!entityId) {
      entityId = uid("ent");
      await insertRow(
        env,
        `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, created_at, updated_at)
         VALUES (?, ?, 'competitor', ?, ?, ?)`,
        entityId,
        workspaceUserId,
        `Boundary parent ${entityId}`,
        ISO_T0,
        ISO_T0,
      );
      sourceTargetEntityByOwner.set(workspaceUserId, entityId);
    }
    const id = uid("tgt");
    await insertRow(
      env,
      `INSERT INTO source_target (
         id, tracked_entity_id, user_id, connector_id, target_key, created_at, updated_at
       ) VALUES (?, ?, ?, 'website', ?, ?, ?)`,
      id,
      entityId,
      workspaceUserId,
      `https://boundary-${id}.example.test`,
      ISO_T0,
      ISO_T0,
    );
    return id;
  },
  async listIds(env, workspaceUserId) {
    const entityId = sourceTargetEntityByOwner.get(workspaceUserId);
    if (!entityId) return [];
    return (
      await listSourceTargetsForEntity(env, workspaceUserId, entityId)
    ).map((row) => row.id);
  },
  async getGuarded(env, workspaceUserId, rowId) {
    return getSourceTarget(env, workspaceUserId, rowId);
  },
  async mutate(env, workspaceUserId, rowId) {
    await updateSourceTargetCoverageLabel(env, workspaceUserId, rowId, "VERIFIED_PUBLIC_FEED");
  },
  async snapshot(env, rowId) {
    return env.DB?.prepare(`SELECT coverage_label FROM source_target WHERE id = ?`)
      .bind(rowId)
      .first<Record<string, unknown>>() ?? null;
  },
};

/** Every OWNED_PROBE_TABLES entry must have exactly one probe here. */
export const OWNED_TABLE_PROBES: OwnedTableProbe[] = [
  watchlistProbe,
  collectionProbe,
  shareLinkProbe,
  customerApiKeyProbe,
  clientRoomProbe,
  agentMemoryProbe,
  supportCaseProbe,
  savedQueryProbe,
  trackedEntityProbe,
  sourceTargetProbe,
];
