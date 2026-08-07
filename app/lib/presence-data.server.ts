import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { newPresenceId, presenceContentHash, presenceUrlHash } from "~/lib/presence-hash";
import type {
  NormalizedPresenceItem,
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresenceItemRecord,
  PresencePollCursorRecord,
  PresenceTrackingMode,
  SourceConnectionRecord,
  SourceConnectionStatus,
  SourceTargetRecord,
  TrackedEntityRecord,
} from "~/lib/presence-types";

function requireDb(env: AppEnv) {
  return ensureDb(env);
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapTrackedEntity(row: Record<string, unknown>): TrackedEntityRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    trackingMode: row.tracking_mode as PresenceTrackingMode,
    label: String(row.label),
    canonicalUrl: row.canonical_url ? String(row.canonical_url) : null,
    notes: row.notes ? String(row.notes) : null,
    isActive: Number(row.is_active) === 1,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSourceTarget(row: Record<string, unknown>): SourceTargetRecord {
  return {
    id: String(row.id),
    trackedEntityId: String(row.tracked_entity_id),
    userId: String(row.user_id),
    connectorId: row.connector_id as PresenceConnectorId,
    targetKey: String(row.target_key),
    targetUrl: row.target_url ? String(row.target_url) : null,
    targetHandle: row.target_handle ? String(row.target_handle) : null,
    metadata: parseJsonObject(row.metadata_json ? String(row.metadata_json) : null),
    coverageLabel: row.coverage_label as PresenceCoverageLabel,
    isActive: Number(row.is_active) === 1,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPresenceItem(row: Record<string, unknown>): PresenceItemRecord {
  return {
    id: String(row.id),
    sourceTargetId: String(row.source_target_id),
    trackedEntityId: String(row.tracked_entity_id),
    userId: String(row.user_id),
    connectorId: row.connector_id as PresenceConnectorId,
    externalId: row.external_id ? String(row.external_id) : null,
    canonicalUrl: String(row.canonical_url),
    urlHash: String(row.url_hash),
    title: String(row.title),
    bodyExcerpt: row.body_excerpt ? String(row.body_excerpt) : null,
    author: row.author ? String(row.author) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    observedAt: String(row.observed_at),
    contentHash: String(row.content_hash),
    raw: row.raw_json ? parseJsonObject(String(row.raw_json)) : null,
    isTombstone: Number(row.is_tombstone) === 1,
    revision: Number(row.revision ?? 1),
    createdAt: String(row.created_at),
  };
}

export async function countTrackedEntities(
  env: AppEnv,
  userId: string,
  options: { trackingMode?: PresenceTrackingMode; activeOnly?: boolean } = {},
) {
  const db = requireDb(env);
  const clauses = ["user_id = ?", "deleted_at IS NULL"];
  const binds: unknown[] = [userId];
  if (options.trackingMode) {
    clauses.push("tracking_mode = ?");
    binds.push(options.trackingMode);
  }
  if (options.activeOnly !== false) {
    clauses.push("is_active = 1");
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM tracked_entity WHERE ${clauses.join(" AND ")}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countSourceTargetsForEntity(
  env: AppEnv,
  trackedEntityId: string,
  connectorId?: PresenceConnectorId,
) {
  const db = requireDb(env);
  const clauses = ["tracked_entity_id = ?", "deleted_at IS NULL", "is_active = 1"];
  const binds: unknown[] = [trackedEntityId];
  if (connectorId) {
    clauses.push("connector_id = ?");
    binds.push(connectorId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM source_target WHERE ${clauses.join(" AND ")}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listTrackedEntities(env: AppEnv, userId: string) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT * FROM tracked_entity
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(mapTrackedEntity);
}

export async function getTrackedEntity(env: AppEnv, userId: string, entityId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT * FROM tracked_entity
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(entityId, userId)
    .first<Record<string, unknown>>();
  return row ? mapTrackedEntity(row) : null;
}

export async function createTrackedEntity(
  env: AppEnv,
  input: {
    userId: string;
    trackingMode: PresenceTrackingMode;
    label: string;
    canonicalUrl?: string | null;
    notes?: string | null;
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const id = newPresenceId("tent");
  await db
    .prepare(
      `INSERT INTO tracked_entity (
        id, user_id, tracking_mode, label, canonical_url, notes,
        is_active, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.trackingMode,
      input.label.trim(),
      input.canonicalUrl ?? null,
      input.notes ?? null,
      now,
      now,
    )
    .run();
  return (await getTrackedEntity(env, input.userId, id))!;
}

export async function listSourceTargetsForEntity(env: AppEnv, userId: string, entityId: string) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT * FROM source_target
       WHERE tracked_entity_id = ? AND user_id = ? AND deleted_at IS NULL AND is_active = 1
       ORDER BY connector_id ASC, created_at ASC`,
    )
    .bind(entityId, userId)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(mapSourceTarget);
}

export async function getSourceTarget(env: AppEnv, userId: string, targetId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT * FROM source_target
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(targetId, userId)
    .first<Record<string, unknown>>();
  return row ? mapSourceTarget(row) : null;
}

export async function upsertSourceTarget(
  env: AppEnv,
  input: {
    userId: string;
    trackedEntityId: string;
    connectorId: PresenceConnectorId;
    targetKey: string;
    targetUrl?: string | null;
    targetHandle?: string | null;
    metadata?: Record<string, unknown>;
    coverageLabel: PresenceCoverageLabel;
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const existing = await db
    .prepare(
      `SELECT id FROM source_target
       WHERE tracked_entity_id = ? AND connector_id = ? AND target_key = ? AND deleted_at IS NULL`,
    )
    .bind(input.trackedEntityId, input.connectorId, input.targetKey)
    .first<{ id: string }>();

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE source_target
         SET target_url = ?, target_handle = ?, metadata_json = ?, coverage_label = ?,
             is_active = 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.targetUrl ?? null,
        input.targetHandle ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.coverageLabel,
        now,
        existing.id,
      )
      .run();
    return (await getSourceTarget(env, input.userId, existing.id))!;
  }

  const id = newPresenceId("stgt");
  await db
    .prepare(
      `INSERT INTO source_target (
        id, tracked_entity_id, user_id, connector_id, target_key, target_url, target_handle,
        metadata_json, coverage_label, is_active, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.trackedEntityId,
      input.userId,
      input.connectorId,
      input.targetKey,
      input.targetUrl ?? null,
      input.targetHandle ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.coverageLabel,
      now,
      now,
    )
    .run();
  return (await getSourceTarget(env, input.userId, id))!;
}

export async function updateSourceTargetCoverageLabel(
  env: AppEnv,
  userId: string,
  targetId: string,
  coverageLabel: PresenceCoverageLabel,
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE source_target
       SET coverage_label = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(coverageLabel, now, targetId, userId)
    .run();
  return getSourceTarget(env, userId, targetId);
}

export async function getPollCursor(env: AppEnv, sourceTargetId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(`SELECT * FROM presence_poll_cursor WHERE source_target_id = ?`)
    .bind(sourceTargetId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    sourceTargetId: String(row.source_target_id),
    cursor: parseJsonObject(row.cursor_json ? String(row.cursor_json) : null),
    etag: row.etag ? String(row.etag) : null,
    lastModified: row.last_modified ? String(row.last_modified) : null,
    lastPolledAt: row.last_polled_at ? String(row.last_polled_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    updatedAt: String(row.updated_at),
  } satisfies PresencePollCursorRecord;
}

/**
 * Batch cursor read for workspace-wide views. One query for any number of
 * targets — the per-target `getPollCursor` in a loop cost up to 240+ D1
 * reads on an Agency workspace snapshot.
 */
const POLL_CURSOR_CHUNK_SIZE = 90;

export async function listPollCursorsForTargets(
  env: AppEnv,
  sourceTargetIds: readonly string[],
): Promise<PresencePollCursorRecord[]> {
  if (sourceTargetIds.length === 0) return [];
  const db = requireDb(env);
  // D1 caps bound parameters per statement; chunk so Agency-scale
  // workspaces (hundreds of targets) stay a handful of queries, never a
  // runtime error and never an N+1.
  const chunks: string[][] = [];
  for (let i = 0; i < sourceTargetIds.length; i += POLL_CURSOR_CHUNK_SIZE) {
    chunks.push([...sourceTargetIds.slice(i, i + POLL_CURSOR_CHUNK_SIZE)]);
  }
  const chunkRows = await Promise.all(
    chunks.map(async (chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await db
        .prepare(
          `SELECT * FROM presence_poll_cursor WHERE source_target_id IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<Record<string, unknown>>();
      return rows.results ?? [];
    }),
  );
  return chunkRows.flat().map((row) => ({
    sourceTargetId: String(row.source_target_id),
    cursor: parseJsonObject(row.cursor_json ? String(row.cursor_json) : null),
    etag: row.etag ? String(row.etag) : null,
    lastModified: row.last_modified ? String(row.last_modified) : null,
    lastPolledAt: row.last_polled_at ? String(row.last_polled_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    updatedAt: String(row.updated_at),
  } satisfies PresencePollCursorRecord));
}

export async function upsertPollCursor(
  env: AppEnv,
  sourceTargetId: string,
  input: Partial<PresencePollCursorRecord>,
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const existing = await getPollCursor(env, sourceTargetId);
  const hasLastErrorCode = Object.prototype.hasOwnProperty.call(input, "lastErrorCode");
  const hasLastErrorMessage = Object.prototype.hasOwnProperty.call(input, "lastErrorMessage");
  await db
    .prepare(
      existing
        ? `UPDATE presence_poll_cursor
           SET cursor_json = ?, etag = ?, last_modified = ?, last_polled_at = ?,
               last_success_at = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
           WHERE source_target_id = ?`
        : `INSERT INTO presence_poll_cursor (
             source_target_id, cursor_json, etag, last_modified, last_polled_at,
             last_success_at, last_error_code, last_error_message, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ...(existing
        ? [
            JSON.stringify(input.cursor ?? existing.cursor),
            input.etag ?? existing.etag,
            input.lastModified ?? existing.lastModified,
            input.lastPolledAt ?? existing.lastPolledAt,
            input.lastSuccessAt ?? existing.lastSuccessAt,
            hasLastErrorCode ? input.lastErrorCode ?? null : existing.lastErrorCode,
            hasLastErrorMessage ? input.lastErrorMessage ?? null : existing.lastErrorMessage,
            now,
            sourceTargetId,
          ]
        : [
            sourceTargetId,
            JSON.stringify(input.cursor ?? {}),
            input.etag ?? null,
            input.lastModified ?? null,
            input.lastPolledAt ?? null,
            input.lastSuccessAt ?? null,
            input.lastErrorCode ?? null,
            input.lastErrorMessage ?? null,
            now,
          ]),
    )
    .run();
}

export async function upsertPresenceItems(
  env: AppEnv,
  input: {
    sourceTarget: SourceTargetRecord;
    items: NormalizedPresenceItem[];
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const changedUrlHashes: string[] = [];

  for (const item of input.items) {
    const urlHash = await presenceUrlHash(item.canonicalUrl);
    const contentHash = item.contentHash || (await presenceContentHash(item));
    const existing = await db
      .prepare(
        `SELECT id, content_hash, revision FROM presence_item
         WHERE source_target_id = ? AND url_hash = ? AND is_tombstone = 0`,
      )
      .bind(input.sourceTarget.id, urlHash)
      .first<{ id: string; content_hash: string; revision: number }>();

    if (existing) {
      if (existing.content_hash !== contentHash || item.isTombstone) {
        const nextRevision = (existing.revision ?? 1) + 1;
        await db
          .prepare(
            `UPDATE presence_item
             SET title = ?, body_excerpt = ?, author = ?, published_at = ?, observed_at = ?,
                 content_hash = ?, raw_json = ?, is_tombstone = ?, revision = ?
             WHERE id = ?`,
          )
          .bind(
            item.title,
            item.bodyExcerpt ?? null,
            item.author ?? null,
            item.publishedAt ?? null,
            item.observedAt,
            contentHash,
            item.raw ? JSON.stringify(item.raw) : null,
            item.isTombstone ? 1 : 0,
            nextRevision,
            existing.id,
          )
          .run();
        await db
          .prepare(
            `INSERT INTO presence_item_revision (
              id, presence_item_id, revision, content_hash, title, body_excerpt, observed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newPresenceId("prev"),
            existing.id,
            nextRevision,
            contentHash,
            item.title,
            item.bodyExcerpt ?? null,
            item.observedAt,
            now,
          )
          .run();
        updated += 1;
        changedUrlHashes.push(urlHash);
      }
      continue;
    }

    const id = newPresenceId("pitem");
    await db
      .prepare(
        `INSERT INTO presence_item (
          id, source_target_id, tracked_entity_id, user_id, connector_id, external_id,
          canonical_url, url_hash, title, body_excerpt, author, published_at, observed_at,
          content_hash, raw_json, is_tombstone, revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.sourceTarget.id,
        input.sourceTarget.trackedEntityId,
        input.sourceTarget.userId,
        input.sourceTarget.connectorId,
        item.externalId ?? null,
        item.canonicalUrl,
        urlHash,
        item.title,
        item.bodyExcerpt ?? null,
        item.author ?? null,
        item.publishedAt ?? null,
        item.observedAt,
        contentHash,
        item.raw ? JSON.stringify(item.raw) : null,
        item.isTombstone ? 1 : 0,
        1,
        now,
      )
      .run();
    inserted += 1;
    changedUrlHashes.push(urlHash);
  }

  return { inserted, updated, changedUrlHashes };
}

export async function reconcilePresenceItemsAfterPoll(
  env: AppEnv,
  input: {
    sourceTarget: SourceTargetRecord;
    observedUrlHashes: string[];
    completeSnapshot: boolean;
  },
) {
  // Empty public feeds can be transient, so never mass-tombstone without at least
  // one observed item anchoring the authoritative snapshot.
  if (!input.completeSnapshot || input.observedUrlHashes.length === 0) {
    return { tombstoned: 0, tombstonedUrlHashes: [] };
  }

  const db = requireDb(env);
  const now = new Date().toISOString();
  const placeholders = input.observedUrlHashes.map(() => "?").join(", ");
  const unseenClause = placeholders.length > 0 ? `AND url_hash NOT IN (${placeholders})` : "";
  const tombstoneRows = await db
    .prepare(
      `SELECT url_hash FROM presence_item
       WHERE source_target_id = ?
         AND is_tombstone = 0
         ${unseenClause}`,
    )
    .bind(input.sourceTarget.id, ...input.observedUrlHashes)
    .all<{ url_hash: string }>();
  const result = await db
    .prepare(
      `UPDATE presence_item
       SET is_tombstone = 1, observed_at = ?, revision = revision + 1
       WHERE source_target_id = ?
         AND is_tombstone = 0
         ${unseenClause}`,
    )
    .bind(now, input.sourceTarget.id, ...input.observedUrlHashes)
    .run();

  return {
    tombstoned: result.meta.changes ?? 0,
    tombstonedUrlHashes: (tombstoneRows.results ?? []).map((row) => String(row.url_hash)),
  };
}

export async function listPresenceItems(
  env: AppEnv,
  userId: string,
  options: {
    trackedEntityId?: string;
    connectorId?: PresenceConnectorId;
    limit?: number;
    since?: string;
  } = {},
) {
  const db = requireDb(env);
  const clauses = [
    "presence_item.user_id = ?",
    "presence_item.is_tombstone = 0",
    "source_target.is_active = 1",
    "source_target.deleted_at IS NULL",
    "tracked_entity.is_active = 1",
    "tracked_entity.deleted_at IS NULL",
  ];
  const binds: unknown[] = [userId];
  if (options.trackedEntityId) {
    clauses.push("presence_item.tracked_entity_id = ?");
    binds.push(options.trackedEntityId);
  }
  if (options.connectorId) {
    clauses.push("presence_item.connector_id = ?");
    binds.push(options.connectorId);
  }
  if (options.since) {
    clauses.push("presence_item.observed_at > ?");
    binds.push(options.since);
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const result = await db
    .prepare(
      `SELECT presence_item.* FROM presence_item
       INNER JOIN source_target ON source_target.id = presence_item.source_target_id
       INNER JOIN tracked_entity ON tracked_entity.id = presence_item.tracked_entity_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY presence_item.observed_at DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(mapPresenceItem);
}

export async function listActiveSourceTargetsForPolling(env: AppEnv, limit = 40) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT source_target.* FROM source_target
       INNER JOIN tracked_entity ON tracked_entity.id = source_target.tracked_entity_id
       WHERE source_target.is_active = 1
         AND source_target.deleted_at IS NULL
         AND source_target.connector_id = 'website'
         AND tracked_entity.is_active = 1
         AND tracked_entity.deleted_at IS NULL
       ORDER BY COALESCE(
         (SELECT last_polled_at FROM presence_poll_cursor WHERE source_target_id = source_target.id),
         '1970-01-01'
       ) ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(mapSourceTarget);
}

export async function softDeleteTrackedEntity(env: AppEnv, userId: string, entityId: string) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tracked_entity
       SET is_active = 0, deleted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(now, now, entityId, userId)
    .run();
  await db
    .prepare(
      `UPDATE source_target
       SET is_active = 0, deleted_at = ?, updated_at = ?
       WHERE tracked_entity_id = ? AND user_id = ?`,
    )
    .bind(now, now, entityId, userId)
    .run();
}

export async function revokeSourceConnectionsForUser(env: AppEnv, userId: string) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE source_connection
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, now, userId)
    .run();
}

export async function upsertSourceConnection(
  env: AppEnv,
  input: {
    userId: string;
    trackedEntityId?: string | null;
    connectorId: PresenceConnectorId;
    encryptedCredentials: string;
    credentialFingerprint: string;
    status: SourceConnectionStatus;
    scopes?: string[];
    externalAccountId?: string | null;
    externalAccountLabel?: string | null;
    lastHealthAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const id = newPresenceId("sconn");
  await db
    .prepare(
      `INSERT INTO source_connection (
        id, user_id, tracked_entity_id, connector_id, encrypted_credentials,
        credential_fingerprint, status, scopes_json, external_account_id,
        external_account_label, last_health_at, last_error_code, last_error_message,
        revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.trackedEntityId ?? null,
      input.connectorId,
      input.encryptedCredentials,
      input.credentialFingerprint,
      input.status,
      JSON.stringify(input.scopes ?? []),
      input.externalAccountId ?? null,
      input.externalAccountLabel ?? null,
      input.lastHealthAt ?? null,
      input.lastErrorCode ?? null,
      input.lastErrorMessage ?? null,
      now,
      now,
    )
    .run();
  return id;
}

export async function getSourceConnectionForEntity(
  env: AppEnv,
  userId: string,
  trackedEntityId: string,
  connectorId: PresenceConnectorId,
) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT * FROM source_connection
       WHERE user_id = ? AND tracked_entity_id = ? AND connector_id = ? AND revoked_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(userId, trackedEntityId, connectorId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    trackedEntityId: row.tracked_entity_id ? String(row.tracked_entity_id) : null,
    connectorId: row.connector_id as PresenceConnectorId,
    encryptedCredentials: String(row.encrypted_credentials),
    credentialFingerprint: String(row.credential_fingerprint),
    status: row.status as SourceConnectionStatus,
    scopes: parseJsonArray(row.scopes_json ? String(row.scopes_json) : null),
    externalAccountId: row.external_account_id ? String(row.external_account_id) : null,
    externalAccountLabel: row.external_account_label ? String(row.external_account_label) : null,
    lastHealthAt: row.last_health_at ? String(row.last_health_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies SourceConnectionRecord;
}
