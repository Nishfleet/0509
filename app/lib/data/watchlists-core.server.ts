import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
import { createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
import {
  toWatchlistRecord,
  type WatchlistRow,
} from "~/lib/data/watchlist-rows.server";
import {
  ensureWebMentionTargetForWatchlist,
  syncWebMentionTargetsForUser,
} from "~/lib/data/watchlist-web-mentions.server";
import type { AppEnv } from "~/lib/env.server";
import {
  decodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
  type ListPageOptions,
  type ListPageResult,
} from "~/lib/list-pagination";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type {
  WatchlistRecord,
  WatchlistTrackingRole,
  WatchTargetType,
} from "~/lib/types";
const WATCHLIST_LIST_COLUMNS = `
  id,
  user_id,
  name,
  target_type,
  tracking_role,
  target_id,
  target_fingerprint,
  target_label,
  target_country,
  is_active,
  last_scanned_at,
  created_at,
  updated_at
`;
const ACTIVE_WATCHLIST_PAGE_SIZE = 100;
const USER_LIST_PAGE_SIZE = 500;
export async function listWatchlistsPage(
  env: AppEnv,
  userId: string,
  options: { includeInactive?: boolean } & ListPageOptions = {},
): Promise<ListPageResult<WatchlistRecord>> {
  // Paused watchlists default to hidden (digests, dashboard counts), but the
  // watchlists page opts in: after a cancellation auto-paused everything, an
  // invisible watchlist looked like a deleted one — a returning subscriber
  // found an "empty" product with no way to resume.
  const limit = resolveListPageLimit(options.limit, USER_LIST_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const activeFilter = options.includeInactive ? "" : "AND is_active = 1";
  const orderBy = options.includeInactive
    ? "is_active DESC, updated_at DESC, id DESC"
    : "updated_at DESC, id DESC";
  const rows = await many<WatchlistRow>(
    env,
    `
      SELECT ${WATCHLIST_LIST_COLUMNS}
      FROM watchlist
      WHERE user_id = ?
        ${activeFilter}
        ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
      ORDER BY ${orderBy}
      LIMIT ?
    `,
    ...(cursor
      ? [userId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [userId, limit]),
  );
  const items = rows.map(toWatchlistRecord);
  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.updatedAt,
      (item) => item.id,
    ),
  };
}
export async function listWatchlists(
  env: AppEnv,
  userId: string,
  options: { includeInactive?: boolean } & ListPageOptions = {},
) {
  const page = await listWatchlistsPage(env, userId, options);
  return page.items;
}
export async function listActiveWatchlistsPage(
  env: AppEnv,
  options: { includeScout?: boolean; includeFree?: boolean } & ListPageOptions = {},
): Promise<ListPageResult<WatchlistRecord>> {
  const limit = resolveListPageLimit(options.limit, ACTIVE_WATCHLIST_PAGE_SIZE);
  // Complex plan-priority ORDER BY makes keyset cursors brittle; use offset
  // tokens for cron paging instead.
  const offset = Math.max(0, Math.floor(Number(options.cursor ?? 0)) || 0);
  const rows = await many<WatchlistRow>(
    env,
    `
      SELECT
        watchlist.id,
        watchlist.user_id,
        watchlist.name,
        watchlist.target_type,
        watchlist.tracking_role,
        watchlist.target_id,
        watchlist.target_fingerprint,
        watchlist.target_label,
        watchlist.target_country,
        watchlist.is_active,
        watchlist.last_scanned_at,
        watchlist.created_at,
        watchlist.updated_at
      FROM watchlist
      LEFT JOIN user_plan
        ON user_plan.user_id = watchlist.user_id
      WHERE watchlist.is_active = 1
        AND (
          user_plan.plan IN ('starter', 'agency')
          OR (? = 1 AND user_plan.plan = 'scout')
          OR (? = 1 AND (user_plan.plan = 'free' OR user_plan.plan IS NULL))
        )
      ORDER BY
        CASE user_plan.plan WHEN 'agency' THEN 0 WHEN 'starter' THEN 1 ELSE 2 END ASC,
        watchlist.updated_at ASC,
        watchlist.id ASC
      LIMIT ?
      OFFSET ?
    `,
    options.includeScout ? 1 : 0,
    // Free weekly watch: purely-free workspaces often have no user_plan row
    // at all (rows are created by billing events), so the free branch matches
    // both an explicit 'free' row and the missing-row case. With the flag off
    // the LEFT JOIN + plan filter is behaviorally identical to the previous
    // INNER JOIN.
    options.includeFree ? 1 : 0,
    limit,
    offset,
  );
  const items = rows.map(toWatchlistRecord);
  return {
    items,
    nextCursor: items.length < limit ? null : String(offset + limit),
  };
}
export async function listActiveWatchlists(
  env: AppEnv,
  options: { includeScout?: boolean; includeFree?: boolean } & ListPageOptions = {},
) {
  // Cron paths need the full active set; page through D1 so a single query
  // never pulls an unbounded watchlist snapshot.
  if (options.limit != null || options.cursor != null) {
    const page = await listActiveWatchlistsPage(env, options);
    return page.items;
  }

  const items: WatchlistRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await listActiveWatchlistsPage(env, {
      includeScout: options.includeScout,
      includeFree: options.includeFree,
      limit: ACTIVE_WATCHLIST_PAGE_SIZE,
      cursor,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}
export async function getWatchlist(env: AppEnv, watchlistId: string, userId?: string) {
  const row = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [watchlistId, userId] : [watchlistId]),
  );

  return row ? toWatchlistRecord(row) : null;
}

/**
 * Compensates a newly created agent watchlist when the final API-key fence
 * fails before Workflow dispatch. A watchlist with any run is no longer safe
 * to remove, so the transaction leaves it and its mention target untouched.
 */
export async function deleteUnscannedWatchlistCreatedByFailedAgentAction(
  env: AppEnv,
  userId: string,
  watchlistId: string,
) {
  const db = ensureDb(env);
  const targetGuard = await billingCanaryMutationGuardSql(env, "web_mention_target.user_id");
  const watchlistGuard = await billingCanaryMutationGuardSql(env, "watchlist.user_id");
  const results = await db.batch([
    db.prepare(`
      DELETE FROM web_mention_target
      WHERE watchlist_id = ?
        AND user_id = ?
        ${targetGuard}
        AND NOT EXISTS (
          SELECT 1
          FROM watchlist_run
          WHERE watchlist_id = ?
        )
    `).bind(watchlistId, userId, watchlistId),
    db.prepare(`
      DELETE FROM watchlist
      WHERE id = ?
        AND user_id = ?
        ${watchlistGuard}
        AND NOT EXISTS (
          SELECT 1
          FROM watchlist_run
          WHERE watchlist_id = ?
        )
    `).bind(watchlistId, userId, watchlistId),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) === 1) return true;

  const unscannedStillPresent = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM watchlist
      WHERE id = ?
        AND user_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM watchlist_run
          WHERE watchlist_id = ?
        )
    `,
    watchlistId,
    userId,
    watchlistId,
  );
  if (Number(unscannedStillPresent?.count ?? 0) > 0) {
    throw new Error("Unscanned watchlist compensation could not be confirmed.");
  }
  return false;
}

export interface CreateWatchlistInput {
  name: string;
  targetType: WatchTargetType;
  targetId: string;
  targetFingerprint: string;
  targetLabel: string;
  targetCountry?: string | null;
  trackingRole?: WatchlistTrackingRole | null;
}
export type CreateWatchlistWithinLimitResult =
  | {
    status: "created" | "existing";
    watchlist: WatchlistRecord;
    current: number;
    limit: number;
  }
  | {
    status: "over_cap";
    watchlist: null;
    current: number;
    limit: number;
  };
export async function createWatchlistWithinLimit(
  env: AppEnv,
  userId: string,
  input: CreateWatchlistInput,
  planLimit: number,
): Promise<CreateWatchlistWithinLimitResult> {
  const limit = Math.max(0, Math.floor(planLimit));
  const trackingRole = normalizeWatchlistTrackingRole(input.trackingRole);
  const existing = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (existing) {
    await ensureWebMentionTargetForWatchlist(env, userId, existing);
    return {
      status: "existing",
      watchlist: toWatchlistRecord(existing),
      current: await countActiveWatchlists(env, userId),
      limit,
    };
  }

  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO watchlist (
        id,
        user_id,
        name,
        target_type,
        tracking_role,
        target_id,
        target_fingerprint,
        target_label,
        target_country,
        is_active,
        created_at,
        updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE ? > (
        SELECT COUNT(*)
        FROM watchlist
        WHERE user_id = ?
          AND is_active = 1
      )
    `,
    id,
    userId,
    input.name.trim(),
    input.targetType,
    trackingRole,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    input.targetCountry ?? null,
    timestamp,
    timestamp,
    limit,
    userId,
  );

  const created = await getWatchlist(env, id, userId);
  if (created) {
    await ensureWebMentionTargetForWatchlist(env, userId, created);
    return {
      status: "created",
      watchlist: created,
      current: await countActiveWatchlists(env, userId),
      limit,
    };
  }

  const concurrent = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (concurrent) {
    await ensureWebMentionTargetForWatchlist(env, userId, concurrent);
    return {
      status: "existing",
      watchlist: toWatchlistRecord(concurrent),
      current: await countActiveWatchlists(env, userId),
      limit,
    };
  }

  return {
    status: "over_cap",
    watchlist: null,
    current: await countActiveWatchlists(env, userId),
    limit,
  };
}
export async function createWatchlist(
  env: AppEnv,
  userId: string,
  input: CreateWatchlistInput,
) {
  const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "?");
  const trackingRole = normalizeWatchlistTrackingRole(input.trackingRole);
  const existing = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (existing) {
    await ensureWebMentionTargetForWatchlist(env, userId, existing);
    return toWatchlistRecord(existing);
  }

  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO watchlist (
        id,
        user_id,
        name,
        target_type,
        tracking_role,
        target_id,
        target_fingerprint,
        target_label,
        target_country,
        is_active,
        created_at,
        updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE 1 = 1 ${billingCanaryGuard}
    `,
    id,
    userId,
    input.name.trim(),
    input.targetType,
    trackingRole,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    input.targetCountry ?? null,
    timestamp,
    timestamp,
    ...(billingCanaryGuard ? [userId] : []),
  );

  const created = await getWatchlist(env, id, userId);
  if (created) {
    await ensureWebMentionTargetForWatchlist(env, userId, created);
    return created;
  }

  const concurrent = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
  );

  if (concurrent) {
    await ensureWebMentionTargetForWatchlist(env, userId, concurrent);
    return toWatchlistRecord(concurrent);
  }

  return null;
}
async function countActiveWatchlists(env: AppEnv, userId: string) {
  const row = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM watchlist
      WHERE user_id = ?
        AND is_active = 1
    `,
    userId,
  );

  return Number(row?.count ?? 0);
}

export async function updateWatchlist(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  input: {
    name: string;
    targetType: WatchTargetType;
    targetId: string;
    targetFingerprint: string;
    targetLabel: string;
    targetCountry?: string | null;
    trackingRole?: WatchlistTrackingRole | null;
  },
) {
  const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "?");
  const existing = await getWatchlist(env, watchlistId, userId);
  if (!existing) {
    return null;
  }
  const trackingRole = normalizeWatchlistTrackingRole(input.trackingRole ?? existing.trackingRole);

  const duplicate = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND tracking_role = ?
        AND target_fingerprint = ?
        AND id != ?
        AND is_active = 1
      LIMIT 1
    `,
    userId,
    trackingRole,
    input.targetFingerprint,
    watchlistId,
  );

  if (duplicate) {
    throw new Error("watchlist_duplicate_target");
  }

  const timestamp = nowIso();
  if (existing.targetFingerprint !== input.targetFingerprint) {
    const replacement = await createWatchlist(env, userId, {
      ...input,
      trackingRole,
    });
    if (!replacement) {
      return null;
    }

    const deactivated = await run(
      env,
      `
        UPDATE watchlist
        SET is_active = 0,
            paused_reason = 'retargeted',
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND is_active = 1
          ${billingCanaryGuard}
      `,
      timestamp,
      watchlistId,
      userId,
      ...(billingCanaryGuard ? [userId] : []),
    );
    if (Number(deactivated.meta?.changes ?? 0) !== 1) {
      return null;
    }

    // Retargeting silently reset alert preferences: carry the per-watchlist
    // delivery config and targets over to the replacement so the customer's
    // settings survive a competitor rebrand/domain change.
    await copyWatchlistDeliverySettings(env, userId, watchlistId, replacement.id);
    await syncWebMentionTargetsForUser(env, userId, timestamp);

    return replacement;
  }

  const updatedResult = await run(
    env,
    `
      UPDATE watchlist
      SET name = ?,
          target_type = ?,
          tracking_role = ?,
          target_id = ?,
          target_fingerprint = ?,
          target_label = ?,
          target_country = ?,
          updated_at = ?
      WHERE id = ?
        AND user_id = ?
        AND is_active = 1
        ${billingCanaryGuard}
    `,
    input.name.trim(),
    input.targetType,
    trackingRole,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    input.targetCountry ?? null,
    timestamp,
    watchlistId,
    userId,
    ...(billingCanaryGuard ? [userId] : []),
  );
  if (Number(updatedResult.meta?.changes ?? 0) !== 1) {
    return null;
  }

  const updated = await getWatchlist(env, watchlistId, userId);
  if (updated) {
    await ensureWebMentionTargetForWatchlist(env, userId, updated);
  }

  return updated;
}
async function copyWatchlistDeliverySettings(
  env: AppEnv,
  userId: string,
  fromWatchlistId: string,
  toWatchlistId: string,
) {
  const timestamp = nowIso();

  await run(
    env,
    `
      INSERT INTO watchlist_delivery_config (
        id, watchlist_id, user_id, sensitivity_mode, instant_enabled,
        digest_enabled, email_enabled, whatsapp_enabled, slack_enabled,
        quiet_hours_json, timezone, created_at, updated_at
      )
      SELECT ?, ?, user_id, sensitivity_mode, instant_enabled,
             digest_enabled, email_enabled, whatsapp_enabled, slack_enabled,
             quiet_hours_json, timezone, ?, ?
      FROM watchlist_delivery_config
      WHERE watchlist_id = ?
    `,
    createId(),
    toWatchlistId,
    timestamp,
    timestamp,
    fromWatchlistId,
  );

  await run(
    env,
    `
      INSERT INTO delivery_target (
        id, user_id, watchlist_id, channel, target_value, validation_status,
        is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
        paused_at, opted_out_at, template_eligible, last_successful_delivery_at,
        last_successful_attempt_id, provider_identifier, metadata_json,
        created_at, updated_at
      )
      SELECT lower(hex(randomblob(16))), user_id, ?, channel, target_value,
             validation_status, is_validated, is_opted_in, opt_in_source,
             opted_in_at, is_paused, paused_at, opted_out_at, template_eligible,
             NULL, NULL, provider_identifier, metadata_json, ?, ?
      FROM delivery_target
      WHERE watchlist_id = ?
        AND user_id = ?
        AND opted_out_at IS NULL
    `,
    toWatchlistId,
    timestamp,
    timestamp,
    fromWatchlistId,
    userId,
  );
}
export async function setWatchlistActive(
  env: AppEnv,
  userId: string,
  watchlistId: string,
  isActive: boolean,
) {
  // Pausing frees the plan slot (limits count active watchlists) and stops
  // scheduled scans; nothing is deleted, so resuming brings the history back.
  const db = ensureDb(env);
  const timestamp = nowIso();
  const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "?");
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = ?,
            paused_reason = ?,
            updated_at = ?
        WHERE id = ?
          AND user_id = ?
          ${billingCanaryGuard}
      `,
    )
    .bind(
      isActive ? 1 : 0,
      isActive ? null : "user",
      timestamp,
      watchlistId,
      userId,
      ...(billingCanaryGuard ? [userId] : []),
    )
    .run();

  const changed = Number(result.meta?.changes ?? 0) > 0;
  if (changed) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}
