import {
  execute as run,
  queryAll as many,
} from "~/lib/data/d1.server";
import { createId, nowIso } from "~/lib/data/helpers.server";
import {
  toWebMentionObservationRecord,
  toWebMentionTargetRecord,
  type WatchlistRow,
  type WebMentionObservationRow,
  type WebMentionTargetRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import { normalizeWatchlistTrackingRole } from "~/lib/watchlist-role";
import type { WatchlistRecord, WebMentionSource } from "~/lib/types";

export async function ensureWebMentionTargetForWatchlist(
  env: AppEnv,
  userId: string,
  watchlist: WatchlistRecord | WatchlistRow,
) {
  const id = createId();
  const timestamp = nowIso();
  const watchlistId = watchlist.id;
  const isRow = "target_label" in watchlist;
  const role = normalizeWatchlistTrackingRole(isRow ? watchlist.tracking_role : watchlist.trackingRole);
  const label = isRow ? watchlist.target_label : watchlist.targetLabel;
  const isActive = isRow ? watchlist.is_active === 1 : watchlist.isActive;

  await run(
    env,
    `
      INSERT OR IGNORE INTO web_mention_target (
        id,
        user_id,
        watchlist_id,
        tracking_role,
        label,
        query_text,
        domain,
        sources_json,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `,
    id,
    userId,
    watchlistId,
    role,
    label,
    label,
    JSON.stringify(["blog", "substack", "web"]),
    isActive ? 1 : 0,
    timestamp,
    timestamp,
  );

  await run(
    env,
    `
      UPDATE web_mention_target
      SET tracking_role = ?,
          label = ?,
          query_text = ?,
          is_active = ?,
          updated_at = ?
      WHERE watchlist_id = ?
        AND user_id = ?
    `,
    role,
    label,
    label,
    isActive ? 1 : 0,
    timestamp,
    watchlistId,
    userId,
  );
}

export async function syncWebMentionTargetsForUser(env: AppEnv, userId: string, timestamp = nowIso()) {
  await run(
    env,
    `
      UPDATE web_mention_target
      SET is_active = (
            SELECT watchlist.is_active
            FROM watchlist
            WHERE watchlist.id = web_mention_target.watchlist_id
              AND watchlist.user_id = web_mention_target.user_id
          ),
          updated_at = ?
      WHERE user_id = ?
        AND watchlist_id IN (
          SELECT id
          FROM watchlist
          WHERE user_id = ?
        )
    `,
    timestamp,
    userId,
    userId,
  );
}

export async function listWebMentionTargets(
  env: AppEnv,
  userId: string,
  options: { watchlistId?: string | null; includeInactive?: boolean; limit?: number | null } = {},
) {
  const clauses = ["user_id = ?"];
  const bindings: unknown[] = [userId];
  if (typeof options.watchlistId !== "undefined") {
    clauses.push(options.watchlistId ? "watchlist_id = ?" : "watchlist_id IS NULL");
    if (options.watchlistId) {
      bindings.push(options.watchlistId);
    }
  }
  if (!options.includeInactive) {
    clauses.push("is_active = 1");
  }

  const rows = await many<WebMentionTargetRow>(
    env,
    `
      SELECT *
      FROM web_mention_target
      WHERE ${clauses.join(" AND ")}
      ORDER BY is_active DESC, updated_at DESC
      LIMIT ?
    `,
    ...bindings,
    Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))),
  );

  return rows.map(toWebMentionTargetRecord);
}

export async function listWebMentionObservations(
  env: AppEnv,
  userId: string,
  options: {
    watchlistId?: string | null;
    sources?: WebMentionSource[] | null;
    includeInactive?: boolean;
    limit?: number | null;
  } = {},
) {
  const sources = (options.sources?.length ? options.sources : ["blog", "substack", "web"])
    .filter((source, index, all): source is WebMentionSource => all.indexOf(source) === index);
  const clauses = ["web_mention_observation.user_id = ?", "web_mention_target.user_id = ?"];
  const bindings: unknown[] = [userId, userId];

  if (typeof options.watchlistId !== "undefined") {
    clauses.push(options.watchlistId ? "web_mention_target.watchlist_id = ?" : "web_mention_target.watchlist_id IS NULL");
    if (options.watchlistId) {
      bindings.push(options.watchlistId);
    }
  }
  if (!options.includeInactive) {
    clauses.push("web_mention_target.is_active = 1");
  }
  if (sources.length > 0) {
    clauses.push(`web_mention_observation.source IN (${sources.map(() => "?").join(", ")})`);
    bindings.push(...sources);
  }

  const rows = await many<WebMentionObservationRow>(
    env,
    `
      SELECT
        web_mention_observation.id,
        web_mention_observation.target_id,
        web_mention_observation.user_id,
        web_mention_observation.source,
        web_mention_observation.source_id,
        web_mention_observation.url,
        web_mention_observation.url_hash,
        web_mention_observation.title,
        web_mention_observation.author,
        web_mention_observation.excerpt,
        web_mention_observation.published_at,
        web_mention_observation.observed_at,
        web_mention_observation.sentiment,
        web_mention_observation.engagement_json,
        web_mention_observation.created_at
      FROM web_mention_observation
      INNER JOIN web_mention_target
        ON web_mention_target.id = web_mention_observation.target_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY web_mention_observation.observed_at DESC
      LIMIT ?
    `,
    ...bindings,
    Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))),
  );

  return rows.map(toWebMentionObservationRecord);
}
