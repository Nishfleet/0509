import {
  ensureDb,
  queryOne as one,
} from "~/lib/data/d1.server";
import { nowIso } from "~/lib/data/helpers.server";
import { syncWebMentionTargetsForUser } from "~/lib/data/watchlist-web-mentions.server";
import type { AppEnv } from "~/lib/env.server";
export function buildWatchlistGrantReconcileStatements(
  db: ReturnType<typeof ensureDb>,
  userId: string,
  keepActive: number,
  timestamp: string,
  acceptedPlan?: {
    plan: string;
    status: string;
    planUpdatedAt: string;
    processedLedgerEventId?: string;
  },
) {
  const acceptedGuard = acceptedPlan
    ? `
        AND EXISTS (
          SELECT 1
          FROM user_plan
          WHERE user_id = ?
            AND plan = ?
            AND dodo_status = ?
            AND plan_updated_at = ?
        )`
    : "";
  const acceptedLedgerGuard = acceptedPlan?.processedLedgerEventId
    ? `
        AND EXISTS (
          SELECT 1
          FROM dodo_webhook_event
          WHERE event_id = ?
            AND outcome = 'processed'
        )`
    : "";
  const acceptedBindings = acceptedPlan
    ? [userId, acceptedPlan.plan, acceptedPlan.status, acceptedPlan.planUpdatedAt]
    : [];
  const acceptedLedgerBindings = acceptedPlan?.processedLedgerEventId
    ? [acceptedPlan.processedLedgerEventId]
    : [];
  return [
    db.prepare(`
      UPDATE watchlist
      SET is_active = 0,
          paused_reason = 'plan_limit',
          updated_at = ?
      WHERE user_id = ?
        AND is_active = 1
        AND id NOT IN (
          SELECT id
          FROM watchlist
          WHERE user_id = ?
            AND is_active = 1
          ORDER BY created_at DESC
          LIMIT ?
        )${acceptedGuard}${acceptedLedgerGuard}
    `).bind(timestamp, userId, userId, keepActive, ...acceptedBindings, ...acceptedLedgerBindings),
    db.prepare(`
      UPDATE watchlist
      SET is_active = 1,
          paused_reason = NULL,
          updated_at = ?
      WHERE user_id = ?
        AND is_active = 0
        AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
        AND id IN (
          SELECT id
          FROM watchlist
          WHERE user_id = ?
            AND is_active = 0
            AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
          ORDER BY updated_at DESC
          LIMIT (
            SELECT MAX(
              0,
              ? - (
                SELECT COUNT(*)
                FROM watchlist
                WHERE user_id = ?
                  AND is_active = 1
              )
            )
          )
        )${acceptedGuard}${acceptedLedgerGuard}
    `).bind(timestamp, userId, userId, keepActive, userId, ...acceptedBindings, ...acceptedLedgerBindings),
  ];
}
export function buildWatchlistRevokeReconcileStatement(
  db: ReturnType<typeof ensureDb>,
  userId: string,
  keepActive: number,
  timestamp: string,
  acceptedPlan?: {
    plan: string;
    status: string;
    planUpdatedAt: string;
  },
) {
  const acceptedGuard = acceptedPlan
    ? `
        AND EXISTS (
          SELECT 1
          FROM user_plan
          WHERE user_id = ?
            AND plan = ?
            AND dodo_status = ?
            AND plan_updated_at = ?
        )`
    : "";
  const acceptedBindings = acceptedPlan
    ? [userId, acceptedPlan.plan, acceptedPlan.status, acceptedPlan.planUpdatedAt]
    : [];
  return db.prepare(`
      UPDATE watchlist
      SET is_active = 0,
          paused_reason = 'plan_limit',
          updated_at = ?
      WHERE user_id = ?
        AND is_active = 1
        AND id NOT IN (
          SELECT id
          FROM watchlist
          WHERE user_id = ?
            AND is_active = 1
          ORDER BY created_at DESC
          LIMIT ?
        )${acceptedGuard}
    `).bind(timestamp, userId, userId, keepActive, ...acceptedBindings);
}
export async function syncWatchlistMentionTargetsIfChanged(
  env: AppEnv,
  userId: string,
  timestamp: string,
  results: Array<{ meta?: { changes?: number } }>,
  watchlistStatementIndexes: number[],
) {
  const watchlistChanges = watchlistStatementIndexes.reduce(
    (total, index) => total + Number(results[index]?.meta?.changes ?? 0),
    0,
  );
  if (watchlistChanges > 0) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
}
export async function deactivateWatchlistsBeyondPlanLimit(
  env: AppEnv,
  userId: string,
  keepActive: number,
) {
  // On downgrade/revocation, watchlists beyond the new plan's limit stop
  // scanning (newest stay active). Rows are deactivated, never deleted, so
  // re-subscribing brings the history back.
  const db = ensureDb(env);
  const timestamp = nowIso();
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = 0,
            paused_reason = 'plan_limit',
            updated_at = ?
        WHERE user_id = ?
          AND is_active = 1
          AND id NOT IN (
            SELECT id
            FROM watchlist
            WHERE user_id = ?
              AND is_active = 1
            ORDER BY created_at DESC
            LIMIT ?
          )
      `,
    )
    .bind(timestamp, userId, userId, Math.max(0, Math.floor(keepActive)))
    .run();

  const changed = Number(result.meta?.changes ?? 0);
  if (changed > 0) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}
export async function reactivateWatchlistsUpToPlanLimit(
  env: AppEnv,
  userId: string,
  limit: number,
) {
  // Inverse of deactivateWatchlistsBeyondPlanLimit: when a plan is granted
  // (first purchase, renewal, resubscribe), bring the most recently active
  // paused watchlists back — up to the plan limit, counting current actives.
  const db = ensureDb(env);
  const activeRow = await one<{ count: number }>(
    env,
    "SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1",
    userId,
  );
  const slots = Math.max(0, Math.floor(limit) - Number(activeRow?.count ?? 0));
  if (slots === 0) {
    return 0;
  }

  const timestamp = nowIso();
  const result = await db
    .prepare(
      `
        UPDATE watchlist
        SET is_active = 1,
            paused_reason = NULL,
            updated_at = ?
        WHERE user_id = ?
          AND is_active = 0
          AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
          AND id IN (
            SELECT id
            FROM watchlist
            WHERE user_id = ?
              AND is_active = 0
              AND (paused_reason = 'plan_limit' OR paused_reason IS NULL)
            ORDER BY updated_at DESC
            LIMIT ?
          )
      `,
    )
    .bind(timestamp, userId, userId, slots)
    .run();

  const changed = Number(result.meta?.changes ?? 0);
  if (changed > 0) {
    await syncWebMentionTargetsForUser(env, userId, timestamp);
  }
  return changed;
}
